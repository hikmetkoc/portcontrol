//! Uygulama klasörlerindeki `.env` dosyalarını okur ve yorumları, sırayı ve
//! tırnak stilini koruyarak günceller.

use std::{collections::HashSet, fs, path::Path};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
}

/// Yalnızca `.env*` adlı dosyalara izin verir; başka dosyalar düzenlenemez.
fn validate(path: &Path) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !name.starts_with(".env") {
        return Err("Yalnızca .env dosyaları düzenlenebilir.".into());
    }
    if !path.parent().is_some_and(Path::is_dir) {
        return Err("Dosyanın bulunduğu klasör yok.".into());
    }
    Ok(())
}

fn parse_line(line: &str) -> Option<(bool, String, String, Option<char>)> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let (exported, body) = match trimmed.strip_prefix("export ") {
        Some(rest) => (true, rest),
        None => (false, trimmed),
    };
    let (key, raw) = body.split_once('=')?;
    let key = key.trim();
    if key.is_empty() || key.contains(' ') {
        return None;
    }
    let raw = raw.trim();
    let (value, quote) = if raw.len() >= 2
        && ((raw.starts_with('"') && raw.ends_with('"'))
            || (raw.starts_with('\'') && raw.ends_with('\'')))
    {
        let quote = raw.chars().next();
        let inner = &raw[1..raw.len() - 1];
        let value = if quote == Some('"') {
            inner
                .replace("\\\"", "\"")
                .replace("\\n", "\n")
                .replace("\\\\", "\\")
        } else {
            inner.to_string()
        };
        (value, quote)
    } else {
        // Tırnaksız değerlerde satır sonu yorumunu at.
        let value = raw.split(" #").next().unwrap_or(raw).trim_end();
        (value.to_string(), None)
    };
    Some((exported, key.to_string(), value, quote))
}

fn format_value(value: &str, quote: Option<char>) -> String {
    let needs_quotes = value.is_empty()
        || value.contains([' ', '#', '"', '\'', '\n', '\t', '='])
        || value.starts_with(char::is_whitespace);
    match quote {
        Some('\'') if !value.contains('\'') && !value.contains('\n') => format!("'{value}'"),
        Some(_) => format!("\"{}\"", escape(value)),
        None if needs_quotes && !value.is_empty() => format!("\"{}\"", escape(value)),
        None => value.to_string(),
    }
}

fn escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

pub fn read_entries(path: &Path) -> Result<Vec<EnvEntry>, String> {
    validate(path)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| format!("Dosya okunamadı: {error}"))?;
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for line in content.lines() {
        if let Some((_, key, value, _)) = parse_line(line)
            && seen.insert(key.clone())
        {
            entries.push(EnvEntry { key, value });
        }
    }
    Ok(entries)
}

/// Mevcut satırları yerinde günceller, silinen anahtarları kaldırır, yenileri sona ekler.
pub fn render(existing: &str, entries: &[EnvEntry]) -> String {
    let mut written = HashSet::new();
    let mut lines = Vec::new();
    for line in existing.lines() {
        match parse_line(line) {
            Some((exported, key, _, quote)) => {
                let Some(entry) = entries.iter().find(|entry| entry.key == key) else {
                    continue;
                };
                if !written.insert(key.clone()) {
                    continue;
                }
                let prefix = if exported { "export " } else { "" };
                lines.push(format!(
                    "{prefix}{key}={}",
                    format_value(&entry.value, quote)
                ));
            }
            None => lines.push(line.to_string()),
        }
    }
    for entry in entries {
        let key = entry.key.trim();
        if key.is_empty() || written.contains(key) {
            continue;
        }
        written.insert(key.to_string());
        lines.push(format!("{key}={}", format_value(&entry.value, None)));
    }
    let mut output = lines.join(if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    });
    output.push_str(if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    });
    output
}

#[tauri::command]
pub fn read_env_file(path: String) -> Result<Vec<EnvEntry>, String> {
    read_entries(Path::new(&path))
}

#[tauri::command]
pub fn write_env_file(path: String, entries: Vec<EnvEntry>) -> Result<(), String> {
    let path = Path::new(&path);
    validate(path)?;
    if entries
        .iter()
        .any(|entry| entry.key.trim().is_empty() || entry.key.contains(['=', ' ', '\n']))
    {
        return Err("Geçersiz değişken adı.".into());
    }
    let existing = fs::read_to_string(path).unwrap_or_default();
    fs::write(path, render(&existing, &entries))
        .map_err(|error| format!("Dosya yazılamadı: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(key: &str, value: &str) -> EnvEntry {
        EnvEntry {
            key: key.into(),
            value: value.into(),
        }
    }

    #[test]
    fn parses_quotes_exports_and_comments() {
        let parsed =
            "# yorum\nexport API_URL=\"http://localhost:2830\"\nNAME='a b'\nPORT=8010 # yerel\n"
                .lines()
                .filter_map(parse_line)
                .map(|(exported, key, value, quote)| (exported, key, value, quote))
                .collect::<Vec<_>>();
        assert_eq!(
            parsed,
            vec![
                (
                    true,
                    "API_URL".into(),
                    "http://localhost:2830".into(),
                    Some('"')
                ),
                (false, "NAME".into(), "a b".into(), Some('\'')),
                (false, "PORT".into(), "8010".into(), None),
            ]
        );
    }

    #[test]
    fn renders_updates_in_place() {
        let existing = "# DB\nDB_URL=postgres://localhost:5432/app\nexport SECRET=\"x\"\nOLD=1\n";
        let output = render(
            existing,
            &[
                entry("DB_URL", "postgres://localhost:5433/app"),
                entry("SECRET", "new value"),
                entry("ADDED", "yes"),
            ],
        );
        assert_eq!(
            output,
            "# DB\nDB_URL=postgres://localhost:5433/app\nexport SECRET=\"new value\"\nADDED=yes\n"
        );
    }

    #[test]
    fn rejects_non_env_files() {
        assert!(read_env_file("C:\\Windows\\win.ini".into()).is_err());
        assert!(write_env_file("Cargo.toml".into(), vec![]).is_err());
    }
}

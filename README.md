<div align="center">
  <img src="./src-tauri/icons/128x128.png" width="96" height="96" alt="PortControl logosu">

# PortControl

**Bilgisayarınızdaki portları hangi uygulamanın, neden açtığını görün ve ilgili süreci güvenle durdurun.**

[![CI](https://github.com/hikmetkoc/portcontrol/actions/workflows/ci.yml/badge.svg)](https://github.com/hikmetkoc/portcontrol/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/hikmetkoc/portcontrol?display_name=tag)](https://github.com/hikmetkoc/portcontrol/releases/latest)
[![License](https://img.shields.io/github/license/hikmetkoc/portcontrol)](./LICENSE)

[Son sürümü indir](https://github.com/hikmetkoc/portcontrol/releases/latest) ·
[Hata bildir](https://github.com/hikmetkoc/portcontrol/issues/new)

</div>

PortControl; Windows, Linux ve macOS üzerinde çalışan, açık TCP/UDP uç noktalarını
port sahibi süreçlerle eşleştiren açık kaynaklı bir Tauri 2 masaüstü
uygulamasıdır. VS Code veya IntelliJ'ın kendi yardımcı servisleriyle gerçekten
yayına alınmış Vite, Spring Boot, .NET, Python ve benzeri geliştirme sunucularını
birbirinden ayırmaya yardımcı olur.

> [!IMPORTANT]
> PortControl bir portu tek başına kapatamaz. Portu kapatmak için o portun sahibi
> olan sürece sonlandırma sinyali gönderir. Kaydedilmemiş veriler
> kaybolabileceğinden durdurma ekranındaki süreç ve port bilgilerini kontrol edin.

## İndirme

Hazır paketler [GitHub Releases](https://github.com/hikmetkoc/portcontrol/releases/latest)
sayfasında yayımlanır.

| İşletim sistemi | Mimari | Paketler | Önerilen |
| --- | --- | --- | --- |
| Windows 10/11 | x64 | `.exe`, `.msi` | NSIS `.exe` kurucusu |
| Linux | x64 | `.AppImage`, `.deb`, `.rpm` | Dağıtımınıza uygun paket |
| macOS 11+ | Intel + Apple Silicon | `.dmg`, `.app` | Evrensel `.dmg` |

Paketler henüz ticari bir kod imzalama sertifikasıyla imzalanmamaktadır:

- Windows SmartScreen ilk çalıştırmada bilinmeyen yayıncı uyarısı gösterebilir.
- macOS paketi ad-hoc imzalıdır ancak noter onaylı değildir. İlk açılışta
  **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** adımı gerekebilir.
- AppImage için dosyayı çalıştırılabilir yapmak gerekebilir:
  `chmod +x PortControl*.AppImage`.

## Neler gösterir?

- TCP `LISTEN`, `ESTABLISHED`, `SYN_SENT`, `CLOSE_WAIT` ve diğer canlı bağlantı
  durumları
- Bir sürecin bağladığı UDP `BOUND` uçları
- Portun sahibi olan PID, uygulama adı ve çalıştırılabilir dosyanın tam yolu
- Komut satırı, çalışma dizini ve süreci başlatan üst süreç zinciri
- Süreç bazında CPU, RAM, disk okuma/yazma hızı ve toplam disk aktarımı
- Portun yalnızca bu bilgisayara mı, yerel ağa mı, yoksa tüm ağ arayüzlerine mi
  açık olduğu
- Sınıflandırma gerekçesi ve yüksek/orta/düşük güven seviyesi

Kaynak tüketimi işletim sistemleri tarafından port başına değil **süreç başına**
raporlandığı için CPU, RAM ve disk değerleri uygulama kartında gösterilir. İlk
taramada CPU ve disk hızı “ölçülüyor” görünebilir; sonraki otomatik yenilemede
iki örnek arasındaki fark hesaplanır.

## Port amacı nasıl ayrılır?

PortControl sınıflandırma yaparken süreç adı, çalıştırılabilir dosya, komut
satırı, çalışma dizini, üst süreçler, port numarası, soket durumu ve ağ kapsamını
birlikte değerlendirir.

| Sınıf | Anlamı | Örnek |
| --- | --- | --- |
| Yayındaki proje | Gerçek bir geliştirme/uygulama sunucusu bağlantı bekliyor | Vite `5173`, Spring Boot `8080` |
| IDE/araç içi | Editörün eklenti, dil sunucusu veya yardımcı süreci | VS Code extension host |
| Altyapı servisi | Veritabanı veya konteyner altyapısı | PostgreSQL, SQL Server, Docker |
| Aktif bağlantı | Süreç başka bir uçla TCP oturumu kurmuş; yayın portu değil | `ESTABLISHED` bağlantı |
| Sistem/güvenlik | İşletim sistemi veya güvenlik yazılımı ucu | Kaspersky `avp.exe`, Defender |
| Belirsiz | Amacı güvenle belirlemek için yeterli kanıt yok | Tanınmayan çalışma zamanı |

Sınıflandırma kanıta dayalı bir tahmindir. Port sahibi ve soket durumu işletim
sisteminden doğrudan alınır; “neden açıldı?” bilgisi ise her zaman işletim
sistemleri tarafından sunulmadığı için gerekçe ve güven seviyesiyle gösterilir.

### LISTEN, ESTABLISHED ve UDP BOUND farkı

- **TCP LISTEN:** Süreç gelen bağlantıları kabul etmek için gerçek bir sunucu ucu
  açmıştır.
- **TCP ESTABLISHED:** İki uç arasında aktif bağlantı vardır. Yerel taraftaki
  geçici port, yayına alınmış bir servis değildir.
- **UDP BOUND:** Süreç UDP portunu ayırmıştır. UDP'de TCP'deki gibi `LISTEN`
  durumu olmadığından bu bilgi tek başına servis yayını anlamına gelmez.

## Güvenlik yaklaşımı

Durdurma işlemi öncesinde PortControl:

1. PID'nin hâlâ var olduğunu kontrol eder.
2. Süreç başlangıç zamanını tarama anındaki değerle karşılaştırarak PID yeniden
   kullanımına karşı koruma uygular.
3. Kritik sistem ve güvenlik süreçlerini tekrar denetler.
4. Seçilen uygulama ve etkilenecek portları onay ekranında gösterir.

Kaspersky `avp.exe`, Microsoft Defender ve tanınan diğer güvenlik süreçleri
varsayılan görünümde gizlenir ve uygulama içinden durdurulamaz. Başka kullanıcıya
veya sistem hesabına ait süreçler için yönetici/root yetkisi gerekebilir;
PortControl kendiliğinden yetki yükseltmez.

## Filtreler

- Uygulama, süreç, PID veya port numarasıyla arama
- TCP/UDP protokolü
- `LISTEN`, aktif TCP bağlantıları ve UDP `BOUND`
- Yayındaki proje, IDE içi servis, altyapı, sistem veya belirsiz amaç
- Uygulama kategorisi
- Sistem/güvenlik süreçlerini gösterme veya gizleme

## Geliştirme

### Gereksinimler

- Node.js 20.19+ veya 22+
- Rust 1.88+
- İşletim sisteminize ait
  [Tauri önkoşulları](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/hikmetkoc/portcontrol.git
cd portcontrol
npm ci
npm run tauri dev
```

Yalnızca arayüzü örnek verilerle tarayıcıda çalıştırmak için:

```bash
npm run dev
```

Gerçek port taraması ve süreç durdurma komutları yalnızca Tauri masaüstü
penceresinde çalışır.

### Test ve derleme

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Yerel Tauri paketi yalnızca komutun çalıştırıldığı işletim sistemi için
oluşturulur. `main` dalı ve pull request'ler GitHub Actions üzerinde Windows,
Ubuntu ve macOS ile doğrulanır. `v*` sürüm etiketi gönderildiğinde üç platformun
kurulum paketleri otomatik olarak aynı GitHub Release kaydına yüklenir.

## Teknik yapı

- [Tauri 2](https://tauri.app/) ve Rust sistem katmanı
- React 19, TypeScript ve Vite arayüzü
- `netstat2` ile soket/PID eşleştirme
- `sysinfo` ile süreç ağacı ve kaynak ölçümleri
- Vitest ve Rust birim/entegrasyon testleri

## Sınırlamalar

- Bazı sistem süreçlerinin komut satırı, çalışma dizini veya kaynak bilgileri
  yetki yetersizliği nedeniyle okunamayabilir.
- Konteyner veya sanal makine içindeki süreç adı, ana işletim sisteminde yalnızca
  Docker/VM altyapı süreci olarak görünebilir.
- Amaç sınıflandırması yeni veya tanınmayan araçlarda “Belirsiz” kalabilir.
- Bir sürecin durdurulması, o sürece ait tüm portları ve etkin işleri kapatır.

## Katkı ve lisans

Hata raporları ve pull request'ler kabul edilir. Güvenlik süreci korumasını
zayıflatan değişikliklerde neden ve test senaryosu mutlaka açıklanmalıdır.

Bu proje [MIT Lisansı](./LICENSE) ile yayımlanır.

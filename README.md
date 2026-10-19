<div align="center">
  <img src="./src-tauri/icons/128x128.png" width="96" height="96" alt="PortControl logosu">

# PortControl

**Geliştirme projelerini tek tıkla ayağa kaldırın; açık portlarını radarda, loglarını canlı konsolda izleyin.**

[![CI](https://github.com/hikmetkoc/portcontrol/actions/workflows/ci.yml/badge.svg)](https://github.com/hikmetkoc/portcontrol/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/hikmetkoc/portcontrol?display_name=tag)](https://github.com/hikmetkoc/portcontrol/releases/latest)
[![License](https://img.shields.io/github/license/hikmetkoc/portcontrol)](./LICENSE)

[Son sürümü indir](https://github.com/hikmetkoc/portcontrol/releases/latest) ·
[Hata bildir](https://github.com/hikmetkoc/portcontrol/issues/new)

</div>

PortControl; Windows, Linux ve macOS üzerinde çalışan, kod yazdırmayan bir "geliştirme
IDE'si" gibi tasarlanmış açık kaynaklı bir Tauri 2 masaüstü uygulamasıdır. Çalışma
klasörünüzü proje olarak eklediğinizde içindeki tüm frontend, backend ve altyapı
uygulamalarını bulur, varsayılan ya da seçtiğiniz portta başlatır ve çıktılarını renkli
bir konsolda akıtır. Port radarı ise yalnızca yazılım geliştirme projelerinin açtığı
portları gösterir; sistem, güvenlik ve IDE iç servisleri listeye hiç girmez.

> [!IMPORTANT]
> PortControl bir portu tek başına kapatamaz. Portu kapatmak için o portun sahibi
> olan sürece sonlandırma sinyali gönderir. Kaydedilmemiş veriler
> kaybolabileceğinden durdurma ekranındaki süreç ve port bilgilerini kontrol edin.

## İndirme

Hazır paketler [GitHub Releases](https://github.com/hikmetkoc/portcontrol/releases/latest)
sayfasında yayımlanır.

### v0.4.0 öne çıkanlar

- Tamamen yenilenen neon komuta merkezi arayüzü: özel pencere çubuğu, etkinlik
  çubuğu, proje gezgini, alt konsol paneli ve durum çubuğu
- **Projeler:** çalışma klasörü eklenir, içindeki ayağa kaldırılabilir uygulamalar
  otomatik tespit edilir ve tek tıkla başlatılır/durdurulur/yeniden başlatılır
- Varsayılan portta ya da **özel portta** başlatma; port çakışmasını başlatmadan önce
  yakalama ve en yakın boş portu önerme
- **Fırlatma sekansı:** projedeki tüm uygulamaları altyapı → backend → frontend
  sırasıyla başlatır, dolu portları otomatik kaydırır
- **Canlı konsol:** ANSI renkleri, hata/uyarı vurgusu, arama, tıklanabilir adresler,
  zaman damgaları ve çalışan sürece stdin girdisi gönderme
- **Port radarı:** yalnızca geliştirme projelerinin dinlediği portlar; isteğe bağlı
  altyapı (veritabanı/Docker) görünümü
- **Olay akışı:** açılan/kapanan portlar ile başlatma, hazır olma ve çökme olaylarının
  zaman çizelgesi
- `Ctrl+K` komut paleti, sistem haritası, CPU/RAM mini grafikleri ve hazır bildirimleri
- **Bağımlılık zinciri:** yapılandırmadan bağımlılıkları bulur, sırayla başlatır ve
  sağlık kontrolüyle hazır olmalarını bekler
- **Ortam profilleri ve `.env` düzenleyici**, Spring/.NET profil seçimi
- **Çökme bekçisi:** çökme nedenini özetler, isteğe bağlı otomatik yeniden başlatır
- Ağdaki uygulamalar için **telefonda aç (QR)**
- **Sorunlar görünümü:** konsoldaki hata ve uyarılar uygulama bazında, stack trace'lerle
  gruplanmış ve tekrarları birleştirilmiş olarak listelenir
- **Matrix ekran koruyucu** (`Ctrl+Shift+L`, macOS'ta `⌘⌥L`); boşta kalınca da açılabilir
- Java/Maven çıktısı terminaldeki gibi UTF-8 okunur, stdout/stderr gerçek sırasıyla
  gösterilir; 50.000 satır geçmiş ve logu dosyaya kaydetme

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

## Projeler ve uygulama tespiti

Yeni proje oluştururken seçilen klasör (en fazla 6 seviye derinliğe kadar) taranır.
`node_modules`, `target`, `dist`, `build`, `bin`, `obj`, sanal ortamlar ve gizli
klasörler atlanır. Tespit edilen her uygulama için framework, dil, paket yöneticisi,
varsayılan port ve portun nereden okunduğu gösterilir.

| Ekosistem | Tespit edilenler | Varsayılan port kaynağı | Özel port nasıl aktarılır? |
| --- | --- | --- | --- |
| Node.js | Vite (+React/Vue/Svelte/Solid), Next.js, Nuxt, Angular, SvelteKit, Astro, Remix, CRA, Vue CLI, Gatsby, NestJS, Express, Fastify, Koa, Hono, Electron, Tauri | betik parametresi, `vite.config.*`, `angular.json`, `.env`, `listen(...)` | `--port` / `-p` CLI parametresi veya `PORT` |
| JVM | Spring Boot, Quarkus, Micronaut (Maven / Gradle, wrapper desteğiyle) | `application.properties` / `application.yml` | `SERVER_PORT` vb. ortam değişkeni |
| .NET | ASP.NET Core, Blazor | `Properties/launchSettings.json` | `--urls http://localhost:PORT` |
| Python | Django, FastAPI, Flask, Streamlit (`.venv` otomatik) | framework varsayılanı / kaynak kod | CLI parametresi |
| Diğer | Go (Gin, Echo, Fiber, Chi), Rust (Axum, Actix, Rocket…), Laravel/PHP, Rails/Rack, Flutter Web | kaynak kod / framework varsayılanı | CLI parametresi veya `PORT` |
| Altyapı | Docker Compose | `ports:` eşlemeleri | sabit |

Her uygulamanın betiği seçilebilir (`dev`, `start`, `watch`…), komutu düzenlenebilir
ve varsayılana döndürülebilir. `node_modules` eksikse kart üzerinden bağımlılıklar
kurulabilir. PortControl'ün başlattığı süreçler uygulama kapanırken süreç ağacıyla
birlikte sonlandırılır.

## Bağımlılık zinciri ve sağlık kontrolü

Tespit sırasında yapılandırma dosyalarındaki yerel adresler okunur: Angular/Webpack
proxy hedefleri (`proxy.conf.json`), `.env` değişkenleri, `vite.config.*`,
`environment.ts`, Spring `application*.yml|properties`, `appsettings*.json` ve
Python yapılandırmaları. Adres projedeki bir uygulamanın portuna denk gelirse
bağımlılık olarak bağlanır (ör. `client → api`). Port tutmuyor ama anahtar adı
uygulamayı işaret ediyorsa (`app.mpai.base-url` → `mpai`) yine bağlanır ve kartta
"bu servis :8010 portunda bekleniyor" uyarısı çıkar. CORS izinleri ve e-posta
bağlantı tabanı gibi anahtarlar bağımlılık sayılmaz. Projede olmayan servisler
(PostgreSQL, Redis, Elasticsearch…) harici gereksinim olarak listelenir.

- **Zincirle başlatma:** "Tümünü başlat" ve karttaki "Zinciriyle" düğmesi,
  bağımlılıkları sırayla başlatır ve her birinin hazır olmasını bekler. Birbirinden
  bağımsız uygulamalar paralel başlar; fırlatma sekansı paneli adımları canlı gösterir.
- **Sağlık kontrolü:** Spring Actuator (`management.endpoints.web.base-path`
  dahil), FastAPI/Flask `/health` rotaları, .NET `MapHealthChecks` ve frontend dev
  sunucuları otomatik tanınır. 500'ün altındaki her HTTP yanıtı sağlıklı sayılır;
  yol yoksa TCP bağlantısı denetlenir. Çalışan kartlarda gecikmesiyle birlikte gösterilir.
- **Sistem haritası:** bağımlılık okları canlıyken veri akışı animasyonu gösterir,
  port uyuşmazlığında amber kesikli çizgiye döner.

## Ortam profilleri ve .env düzenleyici

- Uygulama başına adlandırılmış ortam profilleri ("Yerel", "Test DB" gibi); etkin
  profilin değişkenleri başlatmada sürece aktarılır. Şifre/token gibi anahtarlar maskelenir.
- Spring (`SPRING_PROFILES_ACTIVE`), .NET (`ASPNETCORE_ENVIRONMENT`), Quarkus ve
  Micronaut profilleri tespit edilen dosyalardan seçilebilir.
- Uygulama klasöründeki `.env` dosyaları yorumlar, sıra ve tırnak stili korunarak
  düzenlenir; yalnızca `.env*` adlı dosyalara yazılabilir.

## Konsol ve Sorunlar

- PortControl'ün başlattığı süreçlerin stdout ve stderr çıktısı tek akıştan, terminaldeki
  sırasıyla okunur. Java süreçlerine `-Dstdout.encoding=UTF-8` eklenir; böylece Windows'ta
  borudan okunan çıktıda Türkçe karakterler bozulmaz. Eklenen ortam değişkenleri her
  çalıştırmanın ilk satırında yazılır.
- Son 50.000 satır saklanır; konsol son 3.000 satırı çizer, eski satırlar isteğe bağlı açılır.
  Log, renk kodları temizlenmiş olarak dosyaya kaydedilebilir.
- Loglardaki etkin profil (Spring `The following profiles are active`, .NET ortamı) konsol
  başlığında gösterilir.
- **Sorunlar** görünümü (`Ctrl+4`) hata ve uyarıları log seviyesine göre ayırır, Java stack
  trace'lerini ve Python traceback'lerini tek soruna gruplar, tekrarları `×N` olarak birleştirir
  ve konsoldaki satıra atlar.

## Çökme bekçisi ve çökme analizi

Çöken sürecin logundan neden özeti çıkarılır: Spring "APPLICATION FAILED TO START"
açıklaması ve önerisi, Java `Caused by` kök nedeni, Python traceback, eksik Node
modülü, bulunamayan komut, port çakışması, derleme hatası ve bağlantı reddi. Kartta
ve konsolda gösterilir; "hata satırına git" ilgili log satırını vurgular. Bekçi
açıksa uygulama 2 sn, 5 sn ve 10 sn arayla en fazla 3 kez yeniden başlatılır.

## Telefonda aç (QR)

Ağa açık (`0.0.0.0`) dinleyen uygulamalar için yerel ağ adresinin QR kodu
gösterilir. Uygulama yalnızca `localhost`'a bağlıysa framework'e göre ağa açma
ipucu verilir (ör. Angular `--host=0.0.0.0`, Vite `--host`).

## Port radarı neyi gösterir?

- Yalnızca yazılım geliştirme projelerine ait TCP `LISTEN` portları
- PortControl'ün başlattığı süreçler ve dışarıdan (VS Code, IntelliJ, terminal)
  başlatılan geliştirme sunucuları ayrı etiketlenir
- Portun yalnızca yerel mi yoksa ağa açık mı olduğu, yerel erişim adresi
- Süreç bazında CPU, RAM ve çalışma süresi

Sistem süreçleri, antivirüs/güvenlik yazılımları, editörlerin dil sunucuları ve
eklenti servisleri, derleme daemon'ları, aktif (`ESTABLISHED`) bağlantılar ve UDP
uçları radara alınmaz. Veritabanı ve Docker gibi altyapı servisleri isteğe bağlı
olarak **Altyapı** anahtarıyla gösterilebilir.

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

### LISTEN ve diğer durumlar

- **TCP LISTEN:** Süreç gelen bağlantıları kabul etmek için gerçek bir sunucu ucu
  açmıştır. Radar yalnızca bu uçları gösterir.
- **TCP ESTABLISHED / UDP BOUND:** Aktif bağlantı ya da ayrılmış UDP portu yayın
  portu anlamına gelmediği için listelenmez.

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

## Kısayollar

| Kısayol | İşlem |
| --- | --- |
| `Ctrl+K` | Komut paleti (başlat, durdur, projeye git, port aç…) |
| `Ctrl+N` | Yeni proje |
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` / `Ctrl+4` | Port radarı / Projeler / Olay akışı / Sorunlar |
| `Ctrl+Shift+L` (macOS: `⌘⌥L`) | Ekran koruyucuyu aç / kapat |
| `Ctrl+\`` | Konsolu aç/kapat |

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

Yalnızca arayüzü örnek verilerle (sahte port taraması, proje tespiti ve süreç
çalıştırıcı) tarayıcıda çalıştırmak için:

```bash
npm run dev
```

Gerçek port taraması, klasör tespiti ve süreç başlatma/durdurma yalnızca Tauri
masaüstü penceresinde çalışır. Windows'ta Rust derlemesi için Visual Studio
Build Tools'un "C++ ile masaüstü geliştirme" iş yükü gerekir.

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
- Kabuk üzerinden süreç başlatan, stdout/stderr akışını olay olarak ileten çalıştırıcı
- `tauri-plugin-dialog` ile klasör seçimi
- Vitest ve Rust birim/entegrasyon testleri

## Sınırlamalar

- Bazı sistem süreçlerinin komut satırı, çalışma dizini veya kaynak bilgileri
  yetki yetersizliği nedeniyle okunamayabilir.
- Konteyner veya sanal makine içindeki süreç adı, ana işletim sisteminde yalnızca
  Docker/VM altyapı süreci olarak görünebilir.
- Amaç sınıflandırması yeni veya tanınmayan araçlarda “Belirsiz” kalabilir.
- Bir sürecin durdurulması, o sürece ait tüm portları ve etkin işleri kapatır.
- Proje tespiti manifest dosyalarına dayalı bir tahmindir; alışılmadık yapılarda
  komutu kart üzerinden düzenleyebilirsiniz.
- Uygulama portu kodda sabitlenmişse ve `PORT` gibi bir değişkeni okumuyorsa özel
  port ayarı etkisiz kalabilir.
- `docker compose up` durdurulduğunda konteynerler çalışmaya devam edebilir; tamamen
  kapatmak için `down` betiğini kullanın.

## Katkı ve lisans

Hata raporları ve pull request'ler kabul edilir. Güvenlik süreci korumasını
zayıflatan değişikliklerde neden ve test senaryosu mutlaka açıklanmalıdır.

Bu proje [MIT Lisansı](./LICENSE) ile yayımlanır.

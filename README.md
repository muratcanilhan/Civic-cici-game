# Modoğlu Denizcilik — Fuar CRM

Statik `index.html`, merkezi Supabase üzerindeki özel CRM oturumları ve RPC işlevleriyle çalışır.

## Güvenilir müşteri kaydı

Müşteri ekleme, kayıt kimliğinin doğrulanması ve liste yenileme ayrı aşamalardır. Liste yenileme hatası, başarılı kaydı başarısız göstermez. Başarıdan sonra ekran otomatik değişmez; kayıt kimliği formda görünür. Form yalnızca geçerli sunucu yanıtından sonra temizlenir. Gönderim sırasında düzenleme, temizleme, uygulama içi gezinme ve çıkış engellenir.

Her gönderime tarayıcıda bir UUID atanır. Yanıt kaybolursa, zaman aşımı olursa veya sunucu yanıtı doğrulanamazsa aynı UUID ve aynı veri korunur. “Kayıt Sonucunu Kontrol Et”, aynı işlemi tekrar gönderir. Veritabanı kilidi, müşteri ekleme ve işlem makbuzunu tek transaction içinde tutar: eşzamanlı veya sonraki tekrarlar yeni müşteri yerine aynı kayıt kimliğini döndürür. Aynı UUID başka kullanıcı/veri için kullanılamaz. Eski `crm_add_customer` silinmez veya değiştirilmez.

Form taslağı ve bekleyen işlem, kullanıcı kimliğine göre bu sekmenin `sessionStorage` alanında tutulur; sayfa yenilenince geri yüklenir. Taslak müşteri bilgilerini içerir, oturum anahtarını içermez. Gönderimden önce depolama başarısız olursa istek gönderilmez. Bekleyen işlemde alanlar korunur ve kilitlenir; yeniden giriş gerekiyorsa aynı kullanıcı ile giriş yapılmalıdır. Sekmeyi kapatmak, site verilerini silmek, farklı cihaz/sekmeden yeni işlem başlatmak bu korumanın dışındadır. İşlem kimliği iş kuralına göre müşteri tekilleştirmesi değildir: bağımsız iki yeni işlem aynı firmayı ekleyebilir.

## Yayına alma sırası

1. Önce **aynı Supabase projesinde**, veritabanı sahibiyle `db/customer-save.sql` çalıştırın. Bu betik yalnızca yeni şema/tablo/işlev ekler; mevcut müşterileri değiştirmez veya silmez. `public.crm_valid_user`, `public.crm_add_customer`, `public.crm_customers` mevcut olmalıdır. Betik yeniden çalıştırılabilir. `crm_private` şemasını Data API'ye açmayın.
2. Test ortamında bir deneme oturumuyla kayıt, kayıp yanıt/tekrar deneme, yetkisiz istek ve liste hatası akışlarını doğrulayın. İki ayrı bağlantıdan aynı işlem kimliğiyle eşzamanlı istek testini staging ortamında yapın.
3. Sonra güncel `index.html` dosyasını yayımlayın. Yeni RPC kurulmadan arayüzü yayımlamayın. Arayüz eksik RPC durumunda eski, çift kayıt üretebilen uç noktaya geri dönmez; taslağı ve işlem kimliğini korur.

Bu değişikliğin geliştirilmesi sırasında canlı şema veya müşteri kayıtlarına yazılmadı. Canlı sistemden yalnızca mevcut işlev tanımları ve sütun bilgileri okundu. SQL betiği PR'ın parçasıdır; PR açılması onu veritabanına uygulamaz.

## İşlem ve hata takibi

- `crm_private.customer_save_requests`: sunucuda kalıcı başarılı işlem makbuzu. İşlem UUID'si, kullanıcı UUID'si, müşteri UUID'si, veri özeti (SHA-256) ve zaman içerir. Müşteri alanları veya oturum anahtarı tutulmaz. RLS etkindir, tarayıcı rollerinin tablo okuma/yazma izni yoktur. Ayrı bir Data API dışı, yetki kontrolü yapan implementation ve izinleri açık public invoker kullanılır.
- Tarayıcı: `sessionStorage.md_crm_save_events` ve konsoldaki `crm_customer_save` olayları; en fazla 100 olay. `submit`, `write_error`, `verification_error`, `confirmed`, `refresh_error`, `refresh_ok`, `client_error` aşamaları, zaman, işlem UUID'si ve varsa HTTP durumu. Ham hata metni, müşteri bilgileri ve token loglanmaz. Bunlar merkezi hata telemetrisi değildir; sekme kapanırsa kaybolabilir.
- İnceleme için kullanıcıdan ekrandaki işlem kimliği alınır. Yetkili veritabanı operatörü parametreli sorguyla `select request_id,user_id,customer_id,created_at from crm_private.customer_save_requests where request_id = $1::uuid` çalıştırabilir. Makbuz olmaması, başka işlem kimliğiyle veya eski arayüzden yapılmış kaydın bulunmadığını kanıtlamaz. Mevcut kayıt kaybı veya eski kayıtların kurtarılması bu düzeltmeyle kanıtlanmış olmaz.
- Makbuzları otomatik silmeyin: eski bir UUID tekrar denendiğinde çift kayda karşı koruma bunlara dayanır. Bu tablo müşteri içeriği yedeği değildir. SQL sahipliği/izinleri ve saklama politikası işletmeci tarafından yönetilmelidir.

## Testler

Node.js 22 veya üstü:

```sh
npm ci --ignore-scripts
npm test
```

Testler canlı Supabase'e bağlanmaz. Tarayıcı mantığı Node VM içinde sahte DOM/depolama/RPC ile, SQL ise PGlite üzerindeki geçici PostgreSQL veritabanında sentetik CRM işlevleriyle çalıştırılır. Kayıp yanıt, aynı kimlikle tekrar, sayfa yenileme, çift gönderim, liste hatası, geçersiz yanıt, boş alan, depolama hataları, log mahremiyeti, sunucu kimlik kontrolü, payload uyuşmazlığı, izinler ve transaction rollback kapsanır. PGlite tek bağlantılıdır; çok bağlantılı kilit yarışı ve gerçek PostgREST dağıtımı staging doğrulaması gerektirir.

Bu ortamda Chromium indirmesi başarısız olduğundan gerçek tarayıcı testi tamamlanamadı; DOM mantığı testleri görsel veya uçtan uca tarayıcı doğrulamasının yerini tutmaz.

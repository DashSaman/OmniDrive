# OmniDrive — وضعیت استقرار و راه‌اندازی شخصی

## وضعیت واقعی ۱۲ اکتبر ۲۰۲۶

پنل و API و S3 روی یک Worker و یک Origin قرار گرفته‌اند:

https://omnidrive-family.golamirreza19954312.workers.dev

Worker: `omnidrive-family`، دیتابیس اختصاصی: `omnidrive-family-20261012`، KV اختصاصی: `OMNIDRIVE_FAMILY_20261012`.

Cloudflare استقرار را پذیرفته، اما درخواست‌های تست از دو محیط با خطای لبه `1010` رد شده‌اند؛ سلامت آنلاین هنوز تأیید نشده است. دیتابیس و KV قدیمی تغییر نکرده‌اند. اتصال واقعی Google، دو حساب، پخش/Seek، rclone و دستگاه‌ها هنوز تست نشده‌اند. PR تا تکمیل تست واقعی ادغام نمی‌شود.

## تنظیم Google توسط صاحب حساب

۱. در پروژه Google Cloud خودتان Google Drive API را فعال کنید.
۲. Google Auth Platform: نام برنامه OmniDrive، مخاطب External. در حالت Testing همه حساب‌های آزمایشی را در Test users اضافه کنید. Scope کامل Drive از نوع Restricted است؛ شرایط شخصی و Verification را بررسی کنید. Refresh Token مربوط به Drive در حالت Testing معمولاً پس از ۷ روز منقضی می‌شود.
۳. OAuth Client از نوع Web application بسازید. Authorized JavaScript origins:

`https://omnidrive-family.golamirreza19954312.workers.dev`

Authorized redirect URIs دقیقاً:

`https://omnidrive-family.golamirreza19954312.workers.dev/api/auth/callback`

۴. در Cloudflare → Worker omnidrive-family → Settings → Variables and Secrets این دو مقدار را به‌صورت **Secret** ثبت کنید:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

مقادیر را در چت، فایل عمومی یا ریپو قرار ندهید.

۵. Secret با نام `SETUP_TOKEN` را با کلید راه‌اندازی تصادفی و شخصی خودتان جایگزین کنید. هنگام ساخت نخستین کاربر در صفحه Register، این کلید را در Owner setup key وارد کنید. اعضای بعدی به Invitation Code نیاز دارند. پس از ساخت مدیر، SETUP_TOKEN را حذف کنید. رمز Cloudflare یا API Token را برای این کلید استفاده نکنید.

۶. در Settings پنل، هر حساب Google را جداگانه وصل و رضایت OAuth را شخصاً تأیید کنید. اتصال Google Drive به ChatGPT جایگزین این مرحله نیست.

## اصلاحات و بررسی

کوکی نشست/OAuth با HttpOnly و Secure در HTTPS و SameSite=Lax؛ PKCE با S256 و state وابسته به کاربر و نشست؛ نگهداری Refresh Token قبلی هنگام اتصال مجدد؛ جلوگیری از ثبت هم‌زمان دو مدیر اولیه؛ شمارنده‌های مستقل rate limit؛ رفع خواندن نادرست توکن رمزگذاری‌شده در آپلود؛ کنترل دسترسی پوشه مقصد و بررسی اندازه واقعی هنگام نهایی‌سازی آپلود.

## نگهداری

`npm ci`، `npm test`، `npm run typecheck -w packages/worker` و `npm run build` را اجرا کنید. فقط بعد از موفقیت بررسی‌ها deploy کنید. توکن Cloudflare و Account ID باید در محیط امن اجرای Wrangler ثبت شوند. پیش از تغییر دیتابیس موجود، D1 export یا Time Travel backup تهیه کنید. schema برای دیتابیس جدید است؛ reset برای داده شخصی ممنوع است. CI فعلی فقط بررسی می‌کند و استقرار خودکار ندارد.

## محدودیت‌های تأییدنشده

- تست واقعی ورود، Logout، اتصال دو حساب، Refresh، آپلود و دانلود/206 و نقش‌های خانواده هنوز انجام نشده است.
- همگام‌سازی Drive بزرگ، CPU موردنیاز bcrypt روی Free، حسابداری اتمیک سهمیه هم‌زمان و آپلود بزرگ multipart نیازمند بررسی بیشتر هستند.
- محدودیت‌های Free با سایر پروژه‌های حساب مشترک‌اند؛ Workers: روزانه ۱۰۰هزار درخواست پویا و ۱۰ms CPU؛ D1: حداکثر ۵۰ query در هر invocation؛ KV: روزانه هزار write. Cron فعلاً هر شش ساعت است.
- نشست TTL ثابت ۷ روز دارد؛ به‌دلیل consistency در KV، ابطال آنی Logout بین همه مناطق تضمین‌شده نیست.
- برای پخش طولانی ویدئو/موسیقی، Open in Drive را ترجیح بدهید. Range به معنی استریم نامحدود مجاز نیست.
- Windows: rclone S3 با آدرس `/s3` و path-style؛ Android/GPlus: مرورگر سازگار. mount واقعی، کدک‌ها و Seek دستگاه‌ها هنوز تأیید نشده‌اند.
- TypeScript کد runtime جداگانه بررسی می‌شود؛ خطاهای typing بعضی تست‌های قدیمی در بررسی جامع کل پوشه هنوز باقی‌اند.

منابع رسمی و جزئیات انگلیسی در `CLOUDFLARE-SETUP.en.md` آمده است.

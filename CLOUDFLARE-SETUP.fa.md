# OmniDrive — راه‌اندازی رایگان و خصوصی روی Cloudflare

> این راهنما برای فورک `DashSaman/OmniDrive` است. **هیچ آدرس، توکن یا شناسه سرویس شخص دیگری نباید در استقرار شما استفاده شود.** هنوز حساب Cloudflare یا پروژه Google Cloud شما به این ریپو وصل نشده است.

## معماری پیشنهادی

- Cloudflare Workers Free: API و OAuth
- Cloudflare Pages Free: رابط React/Vite
- Cloudflare D1 Free: پایگاه داده متادیتا
- Cloudflare KV Free: نشست‌ها و توکن‌های **رمزگذاری‌شده**
- Google Drive: ذخیره واقعی فایل‌ها؛ بدون ذخیره فایل روی VPS

هیچ VPS لازم نیست. ارائه نامحدود حساب گوگل به معنی تضمین ظرفیت یا سهمیه نامحدود Google API / Cloudflare نیست.

## گام‌های استقرار (فقط با حساب‌های خودتان)

1. فورک خودتان را clone کنید، نه repository اصلی توسعه‌دهنده:

   ```bash
   git clone https://github.com/DashSaman/OmniDrive.git
   cd OmniDrive
   npm ci
   npx wrangler login
   ```

2. در داشبورد Google Cloud پروژه‌ای بسازید، **Google Drive API** را فعال کنید، OAuth consent screen را تنظیم کنید و OAuth Client از نوع **Web application** بسازید. برای حالت Testing کاربران مجاز را اضافه کنید. مجوزهای Drive ممکن است نیازمند verification باشند.

3. در حساب **Cloudflare خودتان** منابع مستقل بسازید:

   ```bash
   npx wrangler d1 create omnidrive-personal
   npx wrangler kv namespace create KV
   ```

   شناسه‌های D1 و KV ایجادشده را در `packages/worker/wrangler.toml` قرار دهید. **placeholderها باید عوض شوند.** در `[vars]`، آدرس‌های دقیق HTTPS مربوط به `FRONTEND_URL` و `WORKER_URL` خودتان را بنویسید.

4. چهار Secret اصلی را با Wrangler ثبت کنید. مقدار آن‌ها را هرگز در GitHub، فایل عمومی یا چت منتشر نکنید:

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID --config packages/worker/wrangler.toml
   npx wrangler secret put GOOGLE_CLIENT_SECRET --config packages/worker/wrangler.toml
   npx wrangler secret put JWT_SECRET --config packages/worker/wrangler.toml
   npx wrangler secret put TOKEN_ENCRYPTION_KEY --config packages/worker/wrangler.toml
   ```

   دو Secret آخر باید به صورت تصادفی و با طول مناسب ساخته شوند. `TOKEN_ENCRYPTION_KEY` در این پروژه باید با قالب مورد انتظار `packages/worker/src/lib/crypto.ts` مطابقت داشته باشد.

5. آدرس Redirect ثبت‌شده در Google Cloud باید دقیقاً برابر باشد با:

   `https://YOUR-WORKER.workers.dev/api/auth/callback`

6. دیتابیس را با schema و migrationهای پروژه مقداردهی کنید، سپس Worker را deploy کنید:

   ```bash
   npm run db:migrate:remote -w packages/worker
   npm run deploy -w packages/worker
   ```

   **نکته:** ابتدا migrationها را روی D1 خالی تست کنید و قبل از اجرای هر migration روی دیتابیس موجود backup بگیرید. هرگز reset راه‌انداز را روی دیتای شخصی اجرا نکنید.

7. فایل `packages/web/.env.production` را با آدرس **Worker خودتان** پر کنید:

   ```dotenv
   VITE_API_URL=https://YOUR-WORKER.workers.dev
   ```

   سپس:

   ```bash
   npm run build -w packages/web
   npx wrangler pages deploy packages/web/dist --project-name=omnidrive-personal
   ```

   آدرس واقعی Pages را در `FRONTEND_URL` و `WORKER_URL` واقعی را در تنظیمات Worker ثبت کنید و اگر تغییری دادید دوباره deploy کنید.

## نخستین استفاده و قابلیت‌ها

- اولین کاربر ثبت‌شده نقش مدیر اصلی می‌گیرد. بلافاصله یک رمز قوی ثبت کنید؛ قبل از اجرای عمومی از امن بودن registration اطمینان پیدا کنید.
- از Settings > Add Google Drive هر حساب را به‌صورت جداگانه با OAuth متصل کنید.
- نقش‌های Workspace / اعضای خانواده در UI وجود دارد؛ سطح دسترسی‌ها و اشتراک‌گذاری‌ها باید با چند حساب آزمایشی بررسی شوند.
- برای ویندوز از S3-compatible endpoint با `rclone` استفاده کنید. این endpoint مانند درایو واقعی سیستم‌عامل نیست مگر اینکه آن را mount کنید.
- روی اندروید و تلویزیون GPlus، وب‌اپ در مرورگر ممکن است کار کند؛ سازگاری واقعی با مدل TV و کدک‌ها نیازمند تست دستگاه است.
- فایل‌های معمولی از `GET /api/files/:id/download` دریافت می‌شوند و درخواست Range به Google Drive منتقل می‌شود؛ `?inline=1` فایل را برای مرورگر در حالت inline ارائه می‌کند. پشتیبانی Range مربوط به فایل‌های باینری است و برای Export فایل‌های بومی Docs/Sheets/Slides نیست.

## هزینه و محدودیت‌ها

Cloudflare Workers Free سقف روزانه دارد؛ KV Free فقط ۱۰۰۰ نوشتن در روز دارد. این فورک برای کاهش مصرف، renewal خودکار KV روی هر درخواست و کپی‌های غیرضروری OAuth را حذف کرده است. فایل‌ها همچنان روی Google Drive ذخیره می‌شوند.

**استریم عمومی یا سنگین ویدئو از شبکه Cloudflare روی پلن رایگان تضمین‌شده یا لزوماً مجاز نیست.** برای پخش ویدئو، بازکردن فایل در خود Google Drive را ترجیح بدهید؛ مسیر Worker فقط برای استفاده محدود شخصی و با رعایت سیاست سرویس در نظر گرفته شده است.

## چک‌لیست پیش از تحویل عملیاتی

- [ ] Google OAuth Client و redirect واقعی تنظیم شده
- [ ] D1 / KV اختصاصی و Secrets ثبت شده
- [ ] ورود و اتصال دو Google Drive مستقل تست شده
- [ ] session / logout / role / IDOR با دو کاربر تست شده
- [ ] دانلود معمولی و `Range: bytes=0-1023` با پاسخ `206` تست شده
- [ ] فایل‌ها در ویندوز با rclone قابل لیست و دانلود هستند
- [ ] تست مرورگر اندروید و TV GPlus انجام شده
- [ ] مصرف KV/D1 و لاگ Worker در Dashboard بررسی شده
- [ ] هیچ URL یا secret مربوط به توسعه‌دهنده اصلی در محیط production باقی نمانده

این چک‌لیست **تکمیل استقرار نیست**؛ وضعیت هر مورد فقط بعد از تست عملی مشخص می‌شود.

const s = (v) => (v === null || v === undefined ? '' : String(v));
const EN = {
    verify_email: { subject: () => 'Confirm your email address', lines: (d) => [`Hi ${s(d.name)},`, 'Confirm your email address to finish setting up your account. The link is valid for 24 hours.'], cta: { label: 'Confirm email', link: (d) => d.link } },
    welcome: { subject: () => 'Welcome — your restaurant is ready to set up', lines: (d) => [`Hi ${s(d.name)},`, 'Your email is confirmed. Finish the setup checklist: add your logo, set the staff PIN, print the QR posters and create a test ticket.'] },
    password_reset: { subject: () => 'Reset your password', lines: (d) => [`Hi ${s(d.name)},`, 'Use the link below to choose a new password. It is valid for 1 hour. If you did not ask for this, ignore this email.'], cta: { label: 'Choose a new password', link: (d) => d.link } },
    invitation_manager: { subject: (d) => `You are invited to manage ${s(d.tenantName)}`, lines: (d) => [`You have been invited to help manage ${s(d.tenantName)}. The invitation is valid for 7 days.`], cta: { label: 'Accept invitation', link: (d) => d.link } },
    invitation_owner: { subject: (d) => `Your account for ${s(d.tenantName)} is ready`, lines: (d) => [`An account has been created for ${s(d.tenantName)} and you are its owner. The invitation is valid for 7 days.`], cta: { label: 'Accept and set your password', link: (d) => d.link } },
    ownership_transferred: { subject: (d) => `Ownership of ${s(d.tenantName)} has changed`, lines: (d) => [`The owner of ${s(d.tenantName)} has changed. If you did not expect this, contact support.`] },
    trial_ending: { subject: () => 'Your trial ends in 3 days', lines: (d) => [`The free trial for ${s(d.tenantName)} ends in 3 days. Contact us to choose a plan and keep using it without interruption.`] },
    trial_ended: { subject: () => 'Your trial has ended', lines: (d) => [`The free trial for ${s(d.tenantName)} has ended. Contact us to choose a plan and start creating tickets again. Your data is kept for 90 days.`] },
    payment_failed: { subject: () => 'Payment due', lines: (d) => [`The paid period for ${s(d.tenantName)} has ended. Please renew to avoid interruption; contact us if you have already paid.`] },
    payment_reminder: { subject: () => 'Reminder: payment overdue', lines: (d) => [`The payment for ${s(d.tenantName)} is still overdue. Please renew to avoid suspension.`] },
    suspended_billing: { subject: () => 'Account suspended for non-payment', lines: (d) => [`${s(d.tenantName)} is suspended because payment is overdue. Open tickets can still be completed; new tickets are blocked until payment.`] },
    suspended_platform: { subject: () => 'Account suspended', lines: (d) => [`${s(d.tenantName)} has been suspended by the platform team.`, `Reason: ${s(d.reason)}`, 'Open tickets can still be completed. Contact support to resolve this.'] },
    reactivated: { subject: () => 'Account reactivated', lines: (d) => [`${s(d.tenantName)} is active again.`] },
    subscription_cancelled: { subject: () => 'Subscription cancelled', lines: (d) => [`The subscription for ${s(d.tenantName)} has ended. Your data is kept for 90 days; contact us to renew at any time.`] },
    subscription_reactivated: { subject: () => 'Subscription active', lines: (d) => [`Thank you — ${s(d.tenantName)} is active again.`] },
    deletion_requested: { subject: () => 'Account deletion requested', lines: (d) => ['Your account will be deleted after the 7-day cancel window.', `Deletion date: ${s(d.deleteAfter)}`, 'Cancel it from Settings if this was a mistake.'] },
    deletion_completed: { subject: () => 'Account deleted', lines: () => ['Your account and its data have been deleted. Backups age out within 30 days.'] },
    staff_pin_lock: { subject: () => 'Staff sign-in locked', lines: (d) => [`Too many wrong staff PINs were entered for ${s(d.tenantName)}. Staff sign-in is locked for 15 minutes. If this was not your staff, change the PIN.`] },
    export_ready: { subject: () => 'Your data export is ready', lines: () => ['Your export is ready to download from Settings → Export. The file is kept for 7 days.'] },
    platform_user_invitation: { subject: () => 'Console invitation', lines: (d) => [`Hi ${s(d.name)}, you have been invited to the platform console. You will set a password and an authenticator app.`], cta: { label: 'Accept invitation', link: (d) => d.link } },
    platform_mfa_reset: { subject: () => 'Your second factor was reset', lines: (d) => [`Hi ${s(d.name)}, your second factor was reset by a super admin. Set it up again at your next sign-in.`] },
    support_requested: { subject: () => 'Support access requested', lines: () => ['Platform support asked for temporary access to your account. Approve or refuse it in the admin area.'] },
    support_started: { subject: () => 'Support session started', lines: () => ['A platform support session is active on your account.'] },
    emergency_access: { subject: () => 'Emergency access opened', lines: (d) => [`Platform staff opened emergency access to your account. Reason: ${s(d.reason)}`] },
    weekly_summary: { subject: () => 'Your week in numbers', lines: (d) => weeklyLines(d, 'en') },
    webhook_disabled: { subject: () => 'Webhook endpoint disabled', lines: (d) => [`The webhook endpoint ${s(d.url)} was disabled after repeated failures.`] },
    email_change: { subject: () => 'Confirm your new email address', lines: (d) => [`Hi ${s(d.name)},`, 'You asked to use this address to sign in. Confirm the change within 24 hours.'], cta: { label: 'Confirm new email', link: (d) => d.link } },
    email_changed: {
        subject: (d) => (d.requested ? 'Email change requested' : 'Your sign-in email changed'),
        lines: (d) => [`Hi ${s(d.name)},`, d.requested ? `A change of your sign-in email to ${s(d.newEmail)} was requested. If this was not you, change your password and contact support.` : `Your sign-in email is now ${s(d.newEmail)}. If you did not do this, contact support immediately.`],
    },
    mfa_changed: {
        subject: (d) => (d.removed ? 'Two-factor sign-in was turned off' : 'Your authenticator app changed'),
        lines: (d) => [`Hi ${s(d.name)},`, d.removed ? 'Two-factor sign-in was turned off for your account.' : 'A new authenticator app was set up for your account.', 'Other devices were signed out. If this was not you, reset your password and contact support immediately.'],
    },
};
// Every template exists in Arabic too (W07, FR-ADM-19, TR-EML-01): an owner never gets an English fallback.
const AR = {
    verify_email: { subject: () => 'أكّد بريدك الإلكتروني', lines: (d) => [`مرحبًا ${s(d.name)}،`, 'أكّد بريدك الإلكتروني لإكمال إعداد حسابك. الرابط صالح لمدة 24 ساعة.'], cta: { label: 'تأكيد البريد', link: (d) => d.link } },
    welcome: { subject: () => 'أهلًا بك — مطعمك جاهز للإعداد', lines: (d) => [`مرحبًا ${s(d.name)}،`, 'تم تأكيد بريدك. أكمل قائمة الإعداد: أضف شعارك، عيّن رمز الموظفين، اطبع ملصقات QR وأنشئ تذكرة تجريبية.'] },
    password_reset: { subject: () => 'إعادة تعيين كلمة المرور', lines: (d) => [`مرحبًا ${s(d.name)}،`, 'استخدم الرابط أدناه لاختيار كلمة مرور جديدة. الرابط صالح لمدة ساعة. إذا لم تطلب ذلك فتجاهل هذه الرسالة.'], cta: { label: 'اختيار كلمة مرور جديدة', link: (d) => d.link } },
    invitation_manager: { subject: (d) => `دعوة لإدارة ${s(d.tenantName)}`, lines: (d) => [`تمت دعوتك للمساعدة في إدارة ${s(d.tenantName)}. الدعوة صالحة لمدة 7 أيام.`], cta: { label: 'قبول الدعوة', link: (d) => d.link } },
    invitation_owner: { subject: (d) => `حساب ${s(d.tenantName)} جاهز`, lines: (d) => [`تم إنشاء حساب ${s(d.tenantName)} وأنت مالكه. الدعوة صالحة لمدة 7 أيام.`], cta: { label: 'قبول الدعوة وتعيين كلمة المرور', link: (d) => d.link } },
    ownership_transferred: { subject: (d) => `تغيّرت ملكية ${s(d.tenantName)}`, lines: (d) => [`تغيّر مالك ${s(d.tenantName)}. إذا لم تكن تتوقع ذلك فتواصل مع الدعم.`] },
    trial_ending: { subject: () => 'تنتهي الفترة التجريبية خلال 3 أيام', lines: (d) => [`تنتهي الفترة التجريبية لـ ${s(d.tenantName)} خلال 3 أيام. تواصل معنا لاختيار خطة والاستمرار دون انقطاع.`] },
    trial_ended: { subject: () => 'انتهت الفترة التجريبية', lines: (d) => [`انتهت الفترة التجريبية لـ ${s(d.tenantName)}. تواصل معنا لاختيار خطة وإنشاء التذاكر مجددًا. نحتفظ ببياناتك 90 يومًا.`] },
    payment_failed: { subject: () => 'حان موعد الدفع', lines: (d) => [`انتهت الفترة المدفوعة لـ ${s(d.tenantName)}. يرجى التجديد لتجنّب الانقطاع؛ تواصل معنا إذا كنت قد دفعت.`] },
    payment_reminder: { subject: () => 'تذكير: الدفعة متأخرة', lines: (d) => [`ما زالت دفعة ${s(d.tenantName)} متأخرة. يرجى التجديد لتجنّب تعليق الحساب.`] },
    suspended_billing: { subject: () => 'تم تعليق الحساب لعدم الدفع', lines: (d) => [`تم تعليق ${s(d.tenantName)} لأن الدفعة متأخرة. يمكن إكمال التذاكر المفتوحة، أما التذاكر الجديدة فمتوقفة حتى الدفع.`] },
    suspended_platform: { subject: () => 'تم تعليق الحساب', lines: (d) => [`تم تعليق ${s(d.tenantName)} من قبل فريق المنصة.`, `السبب: ${s(d.reason)}`, 'يمكن إكمال التذاكر المفتوحة. تواصل مع الدعم لحل المشكلة.'] },
    reactivated: { subject: () => 'أُعيد تفعيل الحساب', lines: (d) => [`عاد ${s(d.tenantName)} إلى العمل.`] },
    subscription_cancelled: { subject: () => 'تم إلغاء الاشتراك', lines: (d) => [`انتهى اشتراك ${s(d.tenantName)}. نحتفظ ببياناتك 90 يومًا، وتواصل معنا للتجديد في أي وقت.`] },
    subscription_reactivated: { subject: () => 'الاشتراك فعّال', lines: (d) => [`شكرًا لك — عاد ${s(d.tenantName)} فعّالًا.`] },
    deletion_requested: { subject: () => 'طلب حذف الحساب', lines: (d) => ['سيُحذف حسابك بعد مهلة الإلغاء البالغة 7 أيام.', `تاريخ الحذف: ${s(d.deleteAfter)}`, 'ألغِ الطلب من الإعدادات إذا كان خطأً.'] },
    deletion_completed: { subject: () => 'تم حذف الحساب', lines: () => ['تم حذف حسابك وبياناته. تُحذف النسخ الاحتياطية خلال 30 يومًا.'] },
    staff_pin_lock: { subject: () => 'تم قفل دخول الموظفين', lines: (d) => [`أُدخل رمز موظفين خاطئ عدة مرات لـ ${s(d.tenantName)}. دخول الموظفين مقفل لمدة 15 دقيقة. إذا لم يكن هؤلاء موظفيك فغيّر الرمز.`] },
    export_ready: { subject: () => 'ملف بياناتك جاهز', lines: () => ['ملف التصدير جاهز للتنزيل من الإعدادات ← التصدير. يُحتفظ بالملف 7 أيام.'] },
    platform_user_invitation: { subject: () => 'دعوة إلى لوحة المنصة', lines: (d) => [`مرحبًا ${s(d.name)}، تمت دعوتك إلى لوحة المنصة. ستعيّن كلمة مرور وتطبيق مصادقة.`], cta: { label: 'قبول الدعوة', link: (d) => d.link } },
    platform_mfa_reset: { subject: () => 'أُعيد تعيين عامل التحقق الثاني', lines: (d) => [`مرحبًا ${s(d.name)}، أعاد مسؤول المنصة تعيين عامل التحقق الثاني لديك. أعد إعداده عند تسجيل الدخول التالي.`] },
    support_requested: { subject: () => 'طلب دخول الدعم', lines: () => ['طلب فريق دعم المنصة دخولًا مؤقتًا إلى حسابك. وافق على الطلب أو ارفضه من لوحة الإدارة.'] },
    support_started: { subject: () => 'بدأت جلسة الدعم', lines: () => ['جلسة دعم من فريق المنصة نشطة الآن على حسابك.'] },
    emergency_access: { subject: () => 'تم فتح دخول طارئ', lines: (d) => [`فتح فريق المنصة دخولًا طارئًا إلى حسابك. السبب: ${s(d.reason)}`] },
    weekly_summary: { subject: () => 'أسبوعك بالأرقام', lines: (d) => weeklyLines(d, 'ar') },
    webhook_disabled: { subject: () => 'تم إيقاف عنوان Webhook', lines: (d) => [`تم إيقاف عنوان Webhook ‏${s(d.url)} بعد إخفاقات متكررة.`] },
    email_change: { subject: () => 'أكّد بريدك الجديد', lines: (d) => [`مرحبًا ${s(d.name)}،`, 'طلبت تغيير بريد تسجيل الدخول إلى هذا العنوان. أكّد التغيير خلال 24 ساعة.'], cta: { label: 'تأكيد البريد الجديد', link: (d) => d.link } },
    email_changed: {
        subject: (d) => (d.requested ? 'طلب تغيير بريد الحساب' : 'تغيّر بريد الحساب'),
        lines: (d) => [`مرحبًا ${s(d.name)}،`, d.requested ? `طُلب تغيير بريد تسجيل الدخول إلى ${s(d.newEmail)}. إذا لم تطلب ذلك فغيّر كلمة المرور وتواصل مع الدعم.` : `أصبح بريد تسجيل الدخول ${s(d.newEmail)}. إذا لم تقم بذلك فتواصل مع الدعم فورًا.`],
    },
    mfa_changed: {
        subject: (d) => (d.removed ? 'تم إيقاف التحقق بخطوتين' : 'تغيّر تطبيق المصادقة'),
        lines: (d) => [`مرحبًا ${s(d.name)}،`, d.removed ? 'تم إيقاف التحقق بخطوتين لحسابك.' : 'تم إعداد تطبيق مصادقة جديد لحسابك.', 'تم تسجيل الخروج من الأجهزة الأخرى. إذا لم تقم بذلك فأعد تعيين كلمة المرور وتواصل مع الدعم فورًا.'],
    },
};
/** Weekly summary (FR-RPT-05) from figures, so each owner reads it in their own language. */
function weeklyLines(d, lang) {
    if (typeof d.summary === 'string')
        return [d.summary]; // messages queued before the figures were sent
    const n = (v, unit = '') => (v === null || v === undefined ? '–' : `${String(v)}${unit}`);
    return lang === 'ar'
        ? [
            `${s(d.venue)}، ${s(d.from)} – ${s(d.to)}`,
            `التذاكر: ${n(d.tickets)} (الأسبوع السابق ${n(d.previousTickets)})`,
            `وصل التنبيه عبر الإشعار أو الصفحة المفتوحة: ${n(d.reachPct, '%')}`,
            `أكّد العميل الاستلام: ${n(d.ackPct, '%')}`,
            `متوسط زمن الاستلام: ${n(d.pickupSeconds, ' ث')}`,
        ]
        : [
            `${s(d.venue)}, ${s(d.from)} – ${s(d.to)}`,
            `Tickets: ${n(d.tickets)} (previous week ${n(d.previousTickets)})`,
            `Alert reached by push or open page: ${n(d.reachPct, '%')}`,
            `Customers acknowledged: ${n(d.ackPct, '%')}`,
            `Median pickup: ${n(d.pickupSeconds, ' s')}`,
        ];
}
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function renderEmail(template, locale, data, override) {
    const isAr = locale.startsWith('ar');
    const base = isAr ? AR[template] : EN[template];
    // Edited texts may use {{name}} placeholders filled from the data.
    const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(data[k] ?? ''));
    const t = override ? { subject: () => fill(override.subject), lines: () => override.blocks.map(fill), cta: base.cta } : base;
    const dir = isAr ? 'rtl' : 'ltr';
    const lines = t.lines(data);
    const link = t.cta ? s(t.cta.link(data)) : '';
    const html = `<!doctype html><html lang="${dir === 'rtl' ? 'ar' : 'en'}" dir="${dir}"><body style="margin:0;background:#f4f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:#111827;text-align:${dir === 'rtl' ? 'right' : 'left'}">
<tr><td style="padding:24px 28px 8px;font-size:20px;font-weight:bold">${esc(t.subject(data))}</td></tr>
${lines.map((l) => `<tr><td style="padding:6px 28px;font-size:15px;line-height:1.5">${esc(l)}</td></tr>`).join('')}
${link ? `<tr><td style="padding:18px 28px"><a href="${esc(link)}" style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">${esc(t.cta.label)}</a></td></tr>` : ''}
<tr><td style="padding:18px 28px 24px;font-size:12px;color:#6b7280">Tanbeeh</td></tr>
</table></td></tr></table></body></html>`;
    const text = [...lines, link ? `${t.cta.label}: ${link}` : ''].filter(Boolean).join('\n\n');
    return { subject: t.subject(data), html, text };
}

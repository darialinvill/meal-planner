import { Resend } from 'resend';

let resend = null;
function client() {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

export async function sendVoteEmail({ to, weekStart, weekRange, mealPreview, voteUrl }) {
  const from = process.env.EMAIL_FROM || 'Nourish <onboarding@resend.dev>';
  const subject = `Nourish: vote on meals for the week of ${weekRange}`;

  const previewList = mealPreview
    .map((m) => `<li><strong>${escapeHtml(m.name)}</strong> <span style="color:#666">(${m.meal_type})</span></li>`)
    .join('');

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 22px; margin-bottom: 4px;">Your week of ${escapeHtml(weekRange)} is ready</h1>
      <p style="color:#444; line-height: 1.5;">Vote yes or no on this week's 10 lunches and 10 dinners. Anything either of you marks "yes" will land on the grocery list.</p>
      <p style="margin: 24px 0;">
        <a href="${voteUrl}" style="background:#1f6feb; color:white; padding:10px 18px; border-radius:6px; text-decoration:none; display:inline-block;">Vote on this week's meals</a>
      </p>
      <h2 style="font-size: 16px; margin-top: 28px;">A few previews</h2>
      <ul style="line-height: 1.6;">${previewList}</ul>
      <p style="color:#888; font-size: 12px; margin-top: 32px;">Week starts ${escapeHtml(weekStart)}.</p>
    </div>
  `;

  return client().emails.send({ from, to, subject, html });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

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

// Lightweight markdown → HTML converter sized for our recipe shape:
// ## Headings, ordered/unordered lists, paragraphs. Not a general-purpose renderer.
function recipeMdToHtml(md) {
  const lines = md.split('\n');
  let html = '';
  let inUl = false;
  let inOl = false;
  const closeLists = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeLists(); continue; }
    const h = line.match(/^##\s+(.*)$/);
    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (h) {
      closeLists();
      html += `<h3 style="font-size:14px; margin:14px 0 6px; color:#1f6feb; text-transform:uppercase; letter-spacing:0.04em;">${escapeHtml(h[1])}</h3>`;
    } else if (ul) {
      if (!inUl) { closeLists(); html += '<ul style="margin:0; padding-left:18px; line-height:1.55;">'; inUl = true; }
      html += `<li>${escapeHtml(ul[1])}</li>`;
    } else if (ol) {
      if (!inOl) { closeLists(); html += '<ol style="margin:0; padding-left:20px; line-height:1.55;">'; inOl = true; }
      html += `<li style="margin-bottom:4px;">${escapeHtml(ol[1])}</li>`;
    } else {
      closeLists();
      html += `<p style="margin:6px 0; line-height:1.5;">${escapeHtml(line)}</p>`;
    }
  }
  closeLists();
  return html;
}

export async function sendMenuEmail({ to, weekStart, weekRange, meals, appUrl }) {
  const from = process.env.EMAIL_FROM || 'Nourish <onboarding@resend.dev>';
  const subject = `Nourish: your finalized menu for the week of ${weekRange}`;

  const lunches = meals.filter((m) => m.meal_type === 'lunch');
  const dinners = meals.filter((m) => m.meal_type === 'dinner');

  const renderCard = (m) => `
    <div style="border:1px solid #e5e5e5; border-radius:10px; padding:18px 20px; margin:12px 0; background:#fff;">
      <div style="font-size:18px; font-weight:600; margin-bottom:2px;">${escapeHtml(m.name)}</div>
      <div style="color:#666; font-size:13px; margin-bottom:10px;">
        ${escapeHtml(m.cuisine || '')} · ${(m.prep_minutes || 0) + (m.cook_minutes || 0)} min
      </div>
      <div style="color:#444; font-size:14px; margin-bottom:8px;">${escapeHtml(m.description || '')}</div>
      ${m.kid_bridge ? `<div style="background:#fff7e6; border-left:3px solid #f0a500; padding:8px 10px; font-size:13px; margin:10px 0; border-radius:4px;"><strong>Kid bridge:</strong> ${escapeHtml(m.kid_bridge)}</div>` : ''}
      ${m.recipe_md ? recipeMdToHtml(m.recipe_md) : '<p style="color:#999; font-style:italic;">Recipe will appear here next finalize.</p>'}
    </div>
  `;

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; background:#fafaf7;">
      <h1 style="font-size: 24px; margin-bottom: 4px;">Your menu for the week of ${escapeHtml(weekRange)}</h1>
      <p style="color:#444; line-height:1.5;">You both said yes to the meals below. Recipes are included so you can cook straight from this email, or pop open the app on your phone.</p>
      <p style="margin: 20px 0;">
        <a href="${appUrl}" style="background:#1f6feb; color:white; padding:10px 18px; border-radius:6px; text-decoration:none; display:inline-block;">Open Nourish</a>
      </p>
      ${lunches.length > 0 ? `<h2 style="font-size:18px; margin-top:24px;">Lunches</h2>${lunches.map(renderCard).join('')}` : ''}
      ${dinners.length > 0 ? `<h2 style="font-size:18px; margin-top:24px;">Dinners</h2>${dinners.map(renderCard).join('')}` : ''}
      <p style="color:#888; font-size: 12px; margin-top: 32px;">Week starts ${escapeHtml(weekStart)}.</p>
    </div>
  `;

  return client().emails.send({ from, to, subject, html });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

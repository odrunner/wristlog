import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Private messages (flag 'dms'): badge, inbox + request accept, thread render
// (XSS-safe), unavailable shared post, optimistic send. Supabase fully mocked.

const ME = 'test-user-id-000';
const OTHER = 'u-other-001';
const CONV = 'conv-001';
const REQ = 'conv-req-001';
const json = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
const PROFILE = { id: OTHER, username: 'omegafan', display_name: 'Omega Fan', avatar_url: null };

// opts.inbox: object, or function(callNo) -> object. opts.messages: rows served by dm_messages.
async function boot(page, opts = {}) {
  const state = { respond: [], send: [], start: [], inboxCalls: 0, marks: 0, messages: (opts.messages || []).slice() };
  await mockSupabase(page);
  const R = (name, fn) => page.route(`**/rest/v1/rpc/${name}*`, fn);
  await R('get_experiments', r => json(r, []));
  await R('dm_unread_count', r => json(r, opts.unread ?? 0));
  await R('dm_inbox', r => {
    state.inboxCalls++;
    const v = typeof opts.inbox === 'function' ? opts.inbox(state.inboxCalls, state) : (opts.inbox || {});
    return json(r, v);
  });
  await R('dm_respond', r => { state.respond.push(JSON.parse(r.request().postData() || '{}')); return json(r, null); });
  await R('dm_mark_read', r => { state.marks++; return json(r, null); });
  await R('dm_send', async r => {
    state.send.push(JSON.parse(r.request().postData() || '{}'));
    if (opts.sendGate) await opts.sendGate;
    return json(r, { message_id: 'm-new' });
  });
  await R('dm_start', r => {
    state.start.push(JSON.parse(r.request().postData() || '{}'));
    if (opts.startError) return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: opts.startError }) });
    return json(r, { conversation_id: CONV, status: opts.startStatus || 'accepted' });
  });
  await page.route('**/rest/v1/dm_conversations*', r => json(r, opts.conv || {
    id: CONV, user_lo: ME, user_hi: OTHER, requester_id: OTHER, status: 'accepted',
  }));
  await page.route('**/rest/v1/dm_messages*', r => {
    // Newest-first for the history query; the client reverses.
    const rows = state.messages.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return json(r, rows);
  });
  if (opts.logs) await page.route('**/rest/v1/logs*', r => json(r, opts.logs));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  return state;
}

const msg = (id, body, mins, extra = {}) => ({
  id, conversation_id: CONV, sender_id: OTHER, body, shared_log_id: null, created_at: iso(mins), ...extra,
});

test('header badge shows the mocked unread count', async ({ page }) => {
  await boot(page, { unread: 3 });
  await expect(page.locator('#dm-btn')).toBeVisible();
  await expect(page.locator('#dm-badge')).toBeVisible();
  await expect(page.locator('#dm-badge')).toHaveText('3');
});

test('inbox lists a request with its first message; Accept calls dm_respond and moves it to conversations', async ({ page }) => {
  const reqs = [{ id: REQ, created_at: iso(5), first: { body: 'Love your Speedy, is it for sale?', shared_log_id: null, created_at: iso(5) }, profile: PROFILE }];
  const state = await boot(page, {
    inbox: (n, st) => st.respond.length === 0
      ? { unread: 0, requests_in: reqs, requests_out: [], conversations: [] }
      : { unread: 0, requests_in: [], requests_out: [], conversations: [{
          id: REQ, last_message_at: iso(5), unread: 0,
          last: { body: 'Love your Speedy, is it for sale?', shared_log_id: null, sender_id: OTHER, created_at: iso(5) }, profile: PROFILE }] },
  });
  await page.locator('#dm-btn').click();
  const req = page.locator('#dm-requests');
  await expect(req).toContainText('Omega Fan');
  await expect(req).toContainText('Love your Speedy, is it for sale?');
  await expect(req.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(req.getByRole('button', { name: 'Decline' })).toBeVisible();

  await req.getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('#dm-list .notif-item')).toHaveCount(1);
  await expect(page.locator('#dm-list')).toContainText('Omega Fan');
  await expect(page.locator('#dm-requests')).toHaveText('');
  expect(state.respond).toEqual([{ p_conversation: REQ, p_accept: true }]);
});

test('thread renders message bodies as text: markup never executes', async ({ page }) => {
  const evil = `<img src=x onerror="document.title='xss'">`;
  const state = await boot(page, {
    messages: [msg('m1', 'hello there', 30), msg('m2', evil, 20)],
    inbox: { unread: 0, requests_in: [], requests_out: [], conversations: [{
      id: CONV, last_message_at: iso(20), unread: 1, last: { body: evil, shared_log_id: null, sender_id: OTHER, created_at: iso(20) }, profile: PROFILE }] },
  });
  const titleBefore = await page.title();
  await page.locator('#dm-btn').click();
  await expect(page.locator('#dm-list .notif-item')).toHaveCount(1);
  await expect(page.locator('#dm-list img')).toHaveCount(0);   // inbox preview is escaped too
  await page.locator('#dm-list .notif-item').click();
  const msgs = page.locator('#dm-thread-msgs');
  await expect(msgs).toContainText('hello there');
  await expect(msgs).toContainText(evil);                       // literal text in the bubble
  await expect(msgs.locator('img')).toHaveCount(0);             // no element was created
  expect(await page.title()).toBe(titleBefore);
  expect(await page.title()).not.toBe('xss');
  await expect.poll(() => state.marks).toBeGreaterThan(0);      // opening marks the thread read
});

test('shared post the viewer cannot see renders the "Post unavailable" placeholder', async ({ page }) => {
  await boot(page, {
    logs: [],
    messages: [msg('m1', 'check this out', 10, { shared_log_id: 'log-gone' })],
    inbox: { unread: 0, requests_in: [], requests_out: [], conversations: [{
      id: CONV, last_message_at: iso(10), unread: 0, last: { body: 'check this out', shared_log_id: 'log-gone', sender_id: OTHER, created_at: iso(10) }, profile: PROFILE }] },
  });
  await page.locator('#dm-btn').click();
  await page.locator('#dm-list .notif-item').click();
  await expect(page.locator('#dm-thread-msgs .dm-shared')).toContainText('Post unavailable');
});

test('composer send shows an optimistic bubble and posts p_conversation / p_body to dm_send', async ({ page }) => {
  let release;
  const sendGate = new Promise(res => { release = res; });
  const state = await boot(page, {
    sendGate,
    messages: [msg('m1', 'hello there', 30)],
    inbox: { unread: 0, requests_in: [], requests_out: [], conversations: [{
      id: CONV, last_message_at: iso(30), unread: 0, last: { body: 'hello there', shared_log_id: null, sender_id: OTHER, created_at: iso(30) }, profile: PROFILE }] },
  });
  await page.locator('#dm-btn').click();
  await page.locator('#dm-list .notif-item').click();
  await expect(page.locator('#dm-input')).toBeVisible();
  await page.locator('#dm-input').fill('Sure, DM me a price');
  await page.locator('#dm-input').press('Enter');

  // dm_send is held open: the bubble must already be on screen, marked sending.
  const pending = page.locator('#dm-thread-msgs .dm-msg-pending');
  await expect(pending).toContainText('Sure, DM me a price');
  await expect(pending).toContainText('Sending');
  await expect(page.locator('#dm-input')).toHaveValue('');
  await expect.poll(() => state.send).toEqual([{ p_conversation: CONV, p_body: 'Sure, DM me a price', p_log_id: null }]);

  // Server answers with the real row; the pending bubble is replaced, not duplicated.
  state.messages.push(msg('m-new', 'Sure, DM me a price', 0, { sender_id: ME }));
  release();
  await expect(page.locator('#dm-thread-msgs .dm-msg-pending')).toHaveCount(0);
  await expect(page.locator('#dm-thread-msgs .dm-msg-own')).toHaveCount(1);
  await expect(page.locator('#dm-thread-msgs')).toContainText('Sure, DM me a price');
});

test('header envelope is an SVG icon like the bell, not a text glyph', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#dm-btn svg')).toHaveCount(1);
  expect(await page.locator('#dm-btn').evaluate(b => b.textContent.trim())).toBe('0');   // only the badge text
});

// Pencil -> New message picker -> person -> new-conversation thread -> first send via dm_start.
async function startNewFromPicker(page) {
  await page.evaluate(p => { followingProfiles = [p, { id: 'u-zzz', username: 'zed', display_name: 'Zed Watches' }]; }, PROFILE);
  await page.locator('#dm-btn').click();
  await page.locator('#dm-new-btn').click();
  const modal = page.locator('#dm-new-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.notif-item')).toHaveCount(2);
  await page.locator('#dm-new-search').fill('OMEGA');
  await expect(modal.locator('.notif-item')).toHaveCount(1);
  await modal.locator('.notif-item').click();
  await expect(modal).toBeHidden();
  await expect(page.locator('#dm-thread-head')).toContainText('Omega Fan');
  await expect(page.locator('#dm-input')).toBeVisible();
}

test('new message: picker filters, opens an empty thread, first send binds the conversation', async ({ page }) => {
  const state = await boot(page, {
    inbox: (n, st) => st.start.length === 0
      ? { unread: 0, requests_in: [], requests_out: [], conversations: [] }
      : { unread: 0, requests_in: [], requests_out: [], conversations: [{
          id: CONV, last_message_at: iso(0), unread: 0, last: { body: 'Hi there', shared_log_id: null, sender_id: ME, created_at: iso(0) }, profile: PROFILE }] },
  });
  await startNewFromPicker(page);
  // New-conversation mode: no history fetch, no read mark, no poll.
  expect(state.marks).toBe(0);
  state.messages.push(msg('m-first', 'Hi there', 0, { sender_id: ME }));
  await page.locator('#dm-input').fill('Hi there');
  await page.locator('#dm-input').press('Enter');
  await expect.poll(() => state.start).toEqual([{ p_target: OTHER, p_body: 'Hi there', p_log_id: null }]);
  await expect(page.locator('#dm-thread-msgs .dm-msg-own')).toHaveCount(1);
  await expect(page.locator('#dm-thread-msgs .dm-msg-pending')).toHaveCount(0);
  await expect(page.locator('#dm-input')).toBeVisible();
  expect(state.send).toEqual([]);
});

test('new message to someone who must accept shows the waiting state', async ({ page }) => {
  await boot(page, {
    startStatus: 'pending',
    conv: { id: CONV, user_lo: ME, user_hi: OTHER, requester_id: ME, status: 'pending' },
    inbox: (n, st) => ({ unread: 0, requests_in: [], conversations: [],
      requests_out: st.start.length ? [{ id: CONV, created_at: iso(0), profile: PROFILE }] : [] }),
  });
  await startNewFromPicker(page);
  await page.locator('#dm-input').fill('Is the Speedy for sale?');
  await page.locator('#dm-input').press('Enter');
  await expect(page.locator('#dm-composer')).toContainText('Waiting for Omega Fan to accept');
});

test('new message send error keeps the typed text', async ({ page }) => {
  await boot(page, { startError: 'dm_not_allowed', inbox: { unread: 0, requests_in: [], requests_out: [], conversations: [] } });
  await startNewFromPicker(page);
  await page.locator('#dm-input').fill('Hello?');
  await page.locator('#dm-input').press('Enter');
  await expect(page.locator('#dm-input')).toHaveValue('Hello?');
  await expect(page.locator('#dm-thread-msgs .dm-msg-pending')).toHaveCount(0);
});

test('profile Message button opens the existing thread instead of an inline composer', async ({ page }) => {
  await boot(page, {
    messages: [msg('m1', 'hello there', 30)],
    inbox: { unread: 0, requests_in: [], requests_out: [], conversations: [{
      id: CONV, last_message_at: iso(30), unread: 0, last: { body: 'hello there', shared_log_id: null, sender_id: OTHER, created_at: iso(30) }, profile: PROFILE }] },
  });
  await page.evaluate(id => openDmThreadForUser(id), OTHER);
  await expect(page.locator('#dm-thread-msgs')).toContainText('hello there');
  await expect(page.locator('#dm-thread-head')).toContainText('Omega Fan');
});

test('opening Messages gets the same page-switch hygiene as nav(): top of page, aria-current, focused heading', async ({ page }) => {
  await boot(page, { inbox: { unread: 0, requests_in: [], requests_out: [], conversations: [] } });
  // Deep in the feed, then tap the envelope.
  await page.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 800); });
  await page.evaluate(() => openMessagesPage());
  await expect(page.locator('#page-messages')).toHaveClass(/active/);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // The old tab must not keep aria-current="page" — Messages has no tab of its own.
  expect(await page.evaluate(() => document.querySelectorAll('nav button[aria-current]').length)).toBe(0);
  // A6: screen readers announce the page change via the focused heading.
  expect(await page.evaluate(() => document.activeElement && document.activeElement.textContent)).toBe('Messages');
});

test('a message request names a tappable sender — profile opens before judging it', async ({ page }) => {
  await boot(page, { inbox: { unread: 0, requests_out: [], conversations: [],
    requests_in: [{ id: REQ, created_at: iso(5), profile: PROFILE, first: { body: 'hi', shared_log_id: null } }] } });
  await page.evaluate(() => { window._vupCalls = []; window.viewUserProfile = id => window._vupCalls.push(id); });
  await page.evaluate(() => openMessagesPage());
  const who = page.locator('#dm-requests [role="button"][data-user]', { hasText: 'Omega Fan' });
  await expect(who).toBeVisible();
  await who.click();
  expect(await page.evaluate(() => window._vupCalls)).toEqual(['u-other-001']);
});

test('blocking a member closes their open thread and drops them from inbox + Send-to picker', async ({ page }) => {
  await boot(page, {
    messages: [msg('m1', 'hello there', 30)],
    inbox: { unread: 1, requests_in: [], requests_out: [], conversations: [{
      id: CONV, last_message_at: iso(30), unread: 1,
      last: { body: 'hello there', shared_log_id: null, sender_id: OTHER, created_at: iso(30) }, profile: PROFILE }] },
  });
  await page.evaluate(() => openMessagesPage());
  await page.evaluate(id => openDmThread(id), CONV);
  await expect(page.locator('#dm-thread-view')).toBeVisible();

  await page.evaluate(id => { blockUser(id, 'Omega Fan'); }, OTHER);
  await page.waitForSelector('#confirm-modal:not(.hidden)');
  await page.locator('#confirm-ok-btn').click();

  // Back on the inbox, with the blocked member gone everywhere locally —
  // server-side dm_is_blocked already guards the data; this is the UI's half.
  await expect(page.locator('#dm-thread-view')).toBeHidden();
  await expect(page.locator('#dm-inbox-view')).toBeVisible();
  await expect(page.locator('#dm-list')).not.toContainText('Omega Fan');
  expect(await page.evaluate(() => dmSendTargets().convs.length)).toBe(0);
  expect(await page.evaluate(() => _dmThread)).toBeNull();
});

test('a failed inbox load shows an inline error with Retry — not a blank page', async ({ page }) => {
  await boot(page, { inbox: { unread: 0, requests_in: [], requests_out: [], conversations: [] } });
  // Fail the next dm_inbox call only; the retry falls through to boot's route.
  let failed = 0;
  await page.route('**/rest/v1/rpc/dm_inbox*', r => {
    if (failed++ === 0) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
    return r.fallback();
  });
  await page.evaluate(() => openMessagesPage());
  const retry = page.locator('#dm-list button', { hasText: 'Retry' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.locator('#dm-list button', { hasText: 'Retry' })).toHaveCount(0);
  await expect(page.locator('#dm-empty')).toBeVisible(); // healthy empty state after recovery
});

test('an unread-count change while the inbox is on screen refreshes the rows', async ({ page }) => {
  const conv = { id: CONV, last_message_at: iso(1), unread: 1,
    last: { body: 'fresh arrival', shared_log_id: null, sender_id: OTHER, created_at: iso(1) }, profile: PROFILE };
  await boot(page, { inbox: (n) => n === 1
    ? { unread: 0, requests_in: [], requests_out: [], conversations: [] }
    : { unread: 1, requests_in: [], requests_out: [], conversations: [conv] } });
  await page.evaluate(() => openMessagesPage());
  await expect(page.locator('#dm-empty')).toBeVisible();
  // A new message lands server-side; the 30s poll picks up the new count.
  await page.route('**/rest/v1/rpc/dm_unread_count*', r => json(r, 1));
  await page.evaluate(() => loadDmUnread());
  await expect(page.locator('#dm-list')).toContainText('fresh arrival');
});

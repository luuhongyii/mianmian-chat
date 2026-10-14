import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const screenshots = await mkdtemp(join(tmpdir(), 'mianmian-browser-'));
const server = spawn(process.execPath, ['server/index.mjs', '--production'], {
  env: { ...process.env, PORT: '5194' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;

async function checkInput(page) {
  const result = await page.evaluate(() => {
    const card = document.querySelector('.chat-card').getBoundingClientRect();
    const content = document.querySelector('.chat-content').getBoundingClientRect();
    return ['textarea', '[aria-label="Send message"]'].map(selector => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        selector,
        visible: rect.width > 0 && rect.height > 0,
        inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        inCard: rect.top >= card.top && rect.bottom <= card.bottom,
        inContent: rect.top >= content.top && rect.bottom <= content.bottom,
        hit: hit === element || element.contains(hit),
        rect: rect.toJSON(),
      };
    });
  });
  for (const control of result) {
    for (const key of ['visible', 'inViewport', 'inCard', 'inContent', 'hit']) {
      assert.equal(control[key], true, `${key}: ${JSON.stringify(control)}`);
    }
  }
}

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', code => reject(new Error(`Server exited: ${code}`)));
    server.stderr.on('data', data => process.stderr.write(data));
    server.stdout.on('data', data => {
      if (data.toString().includes('http://127.0.0.1:5194')) resolve();
    });
  });
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of [
    [1920, 1080], [1366, 768], [1280, 720], [800, 600], [640, 480],
    [844, 390], [768, 1024], [390, 844], [375, 667], [320, 568], [390, 350],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.goto('http://127.0.0.1:5194');
      const input = page.locator('textarea');
      await input.waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      assert.equal(await page.title(), "Mianmian · Let's chat");
      assert.doesNotMatch(await page.locator('body').innerText(), /\p{Script=Han}/u);
      await checkInput(page);
      await input.click();
      await input.fill('Testing the input');
      assert.equal(await input.inputValue(), 'Testing the input');
      await checkInput(page);
      await page.getByRole('button', { name: 'History', exact: true }).click();
      const historyPanel = page.getByRole('region', { name: 'Chat history', exact: true });
      assert.equal(await historyPanel.isVisible(), true);
      const panelBox = await historyPanel.boundingBox();
      assert.ok(panelBox && panelBox.x >= 0 && panelBox.y >= 0 && panelBox.x + panelBox.width <= width && panelBox.y + panelBox.height <= height);
      await page.getByRole('button', { name: 'Close history', exact: true }).click();
      await checkInput(page);
      await page.screenshot({ path: join(screenshots, `${width}-${height}.png`) });
      console.log(`PASS visible, clickable, editable: ${width}x${height}`);
    } finally {
      await page.close();
    }
  }

  if (process.argv.includes('--live')) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    let page = await context.newPage();
    try {
      await page.goto('http://127.0.0.1:5194');
      await page.locator('.status-dot.ready').waitFor();
      const input = page.locator('textarea');
      await input.fill('Hi! Please reply in one short sentence.');
      const reply = page.waitForResponse(response => response.url().endsWith('/api/chat'));
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      const response = await reply;
      assert.equal(response.status(), 200);
      await page.locator('.chat-content[aria-busy="false"]').waitFor({ timeout: 100_000 });
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.ok((await page.locator('.rcb-bot-message').last().innerText()).trim());
      assert.doesNotMatch(await page.locator('.rcb-bot-message').last().innerText(), /\p{Script=Han}/u);
      assert.equal(await input.inputValue(), '');
      await checkInput(page);
      await page.screenshot({ path: join(screenshots, 'live-desktop.png') });
      console.log('PASS live NVIDIA reply via send button');

      await page.setViewportSize({ width: 375, height: 667 });
      await checkInput(page);
      await input.fill('Please continue with one short sentence.');
      await input.press('Shift+Enter');
      await input.pressSequentially('Thank you');
      assert.ok((await input.inputValue()).includes('\n'));
      await checkInput(page);
      const nextReply = page.waitForResponse(response => response.url().endsWith('/api/chat'));
      await input.press('Enter');
      const nextResponse = await nextReply;
      assert.equal(nextResponse.status(), 200);
      const messages = nextResponse.request().postDataJSON().messages;
      assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'user']);
      await page.locator('.chat-content[aria-busy="false"]').waitFor({ timeout: 100_000 });
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.equal(await page.locator('.rcb-user-message').count(), 2);
      await checkInput(page);
      await page.screenshot({ path: join(screenshots, 'live-mobile.png') });
      console.log('PASS mobile multiline, Enter send, real follow-up reply, input after scrolling');

      const savedReplies = await page.locator('.rcb-bot-message').allTextContents();
      await page.reload();
      await page.locator('.status-dot.ready').waitFor();
      await page.locator('.rcb-bot-message').nth(1).waitFor();
      assert.deepEqual(await page.locator('.rcb-bot-message').allTextContents(), savedReplies);
      assert.equal(await page.locator('.rcb-user-message').count(), 2);
      await checkInput(page);
      console.log('PASS reload restores both user messages and replies');

      await page.getByRole('button', { name: 'New chat', exact: true }).click();
      await page.locator('.welcome').waitFor();
      assert.equal(await page.locator('.rcb-user-message').count(), 0);
      const secondChat = 'A separate conversation. Please reply briefly.';
      await input.fill(secondChat);
      const separateReply = page.waitForResponse(response => response.url().endsWith('/api/chat'));
      await input.press('Enter');
      const separateResponse = await separateReply;
      assert.equal(separateResponse.status(), 200);
      assert.deepEqual(separateResponse.request().postDataJSON().messages, [{ role: 'user', content: secondChat }]);
      await page.locator('.chat-content[aria-busy="false"]').waitFor({ timeout: 100_000 });
      assert.equal(await page.getByRole('alert').count(), 0);
      await page.getByRole('button', { name: 'History', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: `Open chat: ${secondChat}`, exact: true }).count(), 1);
      await page.screenshot({ path: join(screenshots, 'history-mobile.png'), animations: 'disabled' });
      await page.getByRole('button', { name: 'Open chat: Hi! Please reply in one short sentence.', exact: true }).click();
      await page.locator('.rcb-bot-message').nth(1).waitFor();
      assert.deepEqual(await page.locator('.rcb-bot-message').allTextContents(), savedReplies);
      await input.fill('What did I ask you first? Reply briefly.');
      const resumedReply = page.waitForResponse(response => response.url().endsWith('/api/chat'));
      await input.press('Enter');
      const resumedResponse = await resumedReply;
      assert.equal(resumedResponse.status(), 200);
      const resumedMessages = resumedResponse.request().postDataJSON().messages;
      assert.deepEqual(resumedMessages.map(message => message.role), ['user', 'assistant', 'user', 'assistant', 'user']);
      assert.equal(resumedMessages[0].content, 'Hi! Please reply in one short sentence.');
      assert.equal(resumedMessages.some(message => message.content === secondChat), false);
      await page.locator('.chat-content[aria-busy="false"]').waitFor({ timeout: 100_000 });
      assert.equal(await page.getByRole('alert').count(), 0);
      await checkInput(page);
      console.log('PASS new chat preserves older chat; switching restores its isolated model context');

      await page.close();
      page = await context.newPage();
      await page.goto('http://127.0.0.1:5194');
      await page.locator('.rcb-user-message').nth(2).waitFor();
      await page.locator('.rcb-bot-message').nth(2).waitFor();
      await checkInput(page);
      await page.getByRole('button', { name: 'History', exact: true }).click();
      await page.screenshot({ path: join(screenshots, 'history-desktop.png'), animations: 'disabled' });
      await page.getByRole('button', { name: `Open chat: ${secondChat}`, exact: true }).click();
      await page.locator('.rcb-bot-message').waitFor();
      assert.deepEqual(await page.locator('.rcb-user-message').allTextContents(), [secondChat]);
      await checkInput(page);
      console.log('PASS closing and reopening a tab restores the active chat and retains other conversations');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server.kill();
  console.log(`Screenshots: ${screenshots}`);
}

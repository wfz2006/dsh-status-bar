// Renders the release banner page. Loaded by Electron as the main script.
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');

const payload = JSON.parse(process.env.GLASS_RELEASE_CARD_PAYLOAD ?? '{}');
if (!payload.html || !payload.out) {
  console.error('GLASS_RELEASE_CARD_PAYLOAD needs html and out');
  app.exit(1);
}

// Deterministic 2x output regardless of the display's DPI.
app.commandLine.appendSwitch('force-device-scale-factor', '2');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: payload.width,
    height: payload.height,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#16264a',
    webPreferences: { paintWhenInitiallyHidden: true, backgroundThrottling: false },
  });
  await win.loadFile(payload.html);
  // Windows keeps an invisible resize border, so the usable content area can
  // come up a pixel short. Grow the window by the measured difference.
  const [contentWidth, contentHeight] = win.getContentSize();
  if (contentWidth !== payload.width || contentHeight !== payload.height) {
    win.setContentSize(payload.width + (payload.width - contentWidth), payload.height + (payload.height - contentHeight));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  const image = await win.webContents.capturePage();
  console.log('captured:', JSON.stringify(image.getSize()));
  if (image.isEmpty()) throw new Error('capture returned an empty image');
  writeFileSync(payload.out, image.toPNG());
  app.quit();
}).catch((error) => {
  console.error(error?.stack ?? error);
  app.exit(1);
});

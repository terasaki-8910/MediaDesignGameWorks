// Shared browser launch for the e2e scripts. On Windows, headless Chrome's default ANGLE backend (D3D11) rendered this
// game all white (or with black floors) whenever the render scale was not 1, so headless runs use the GL backend there.
// Headed runs and macOS use the defaults; Linux containers have no GPU and use SwiftShader. `E2E_SOFTWARE=1` asks for
// SwiftShader on any platform, to run what the CI job runs (software WebGL, a few frames a second) on a PC with a GPU.
const { chromium } = require('playwright');

/** Chromium launch arguments for a platform; `headed` runs keep the browser's default backend. */
function launchArgs(platform = process.platform, { headed = false } = {}) {
  if (headed) return [];
  if (platform === 'linux' || process.env.E2E_SOFTWARE === '1') return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (platform === 'win32') return ['--use-angle=gl'];
  return [];
}

/** Launch Chromium with the right arguments (options are merged into Playwright's launch options). */
function launch(options = {}) {
  const headed = options.headless === false;
  return chromium.launch({ args: launchArgs(process.platform, { headed }), ...options });
}

/** The browser version and the WebGL renderer the page really got, for the logs (the flag asked for is not proof). */
async function describeBackend(browser, page) {
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!ctx) return 'no WebGL';
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(ctx.getParameter(ctx.RENDERER));
  });
  return `${browser.browserType().name()} ${browser.version()}; WebGL: ${gl}`;
}

module.exports = { launchArgs, launch, describeBackend };

const ua = navigator.userAgent;
const os =
  /Mac/.test(ua) && !/iPhone|iPad/.test(ua) && navigator.maxTouchPoints < 2
    ? 'mac'
    : /Windows/.test(ua)
      ? 'win'
      : /Linux/.test(ua) && !/Android/.test(ua)
        ? 'linux'
        : null;
const $ = (id) => document.getElementById(id);

// Homebrew covers macOS and Linux. On a Mac it's also the way around the missing notarization.
if (os === 'mac' || os === 'linux') $('brew').hidden = false;
if (os === 'mac') $('mac-note').hidden = $('mac-step').hidden = false;

// Point the download buttons at this OS's installer. Without JS or the API they link to the releases page.
if (os) {
  $('download-label').textContent = `Download for ${{ mac: 'macOS', win: 'Windows', linux: 'Linux' }[os]}`;
  fetch('https://api.github.com/repos/GA16-24/homebrew-tap/releases/latest')
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(async (rel) => {
      // Client hints where the browser has them (Chromium); otherwise Linux user agents name the CPU ("Linux aarch64").
      const arm =
        (await navigator.userAgentData?.getHighEntropyValues?.(['architecture']))?.architecture === 'arm' ||
        /aarch64|arm64/i.test(ua);
      const want = {
        mac: [/mac.*\.dmg$/],
        win: arm ? [/win-arm64\.exe$/, /win-x64\.exe$/] : [/win-x64\.exe$/],
        linux: arm ? [/linux-arm64\.AppImage$/] : [/linux-x86_64\.AppImage$/],
      }[os];
      const asset = want.map((re) => rel.assets.find((a) => re.test(a.name))).find(Boolean);
      if (asset)
        for (const a of document.querySelectorAll('#download, [data-download]')) a.href = asset.browser_download_url;
    })
    .catch(() => {});
}

// With a mouse, a wide screen and WebGL 2, swap the screenshot for the live viewer. Everyone else keeps
// the screenshot, which links to the demo. The viewer only takes input after a click, so scrolling the
// page over it doesn't zoom the camera. Off screen the iframe is removed, not navigated, so it stops
// polling without adding history entries.
const stage = $('stage');
if (matchMedia('(min-width: 960px) and (hover: hover)').matches && window.WebGL2RenderingContext) {
  const href = $('stage-link').href;
  // The embed shares the viewer's saved state with /demo/. Reset what would hide the live build
  // (collapsed panels, another server, the Shaders tab, hidden blocks); theme and language stay.
  try {
    for (const k of ['sidebar', 'inspector', 'server', 'tab', 'hidden']) localStorage.removeItem(`litweb.${k}`);
  } catch {}
  stage.replaceChildren($('stage-link').querySelector('picture'));
  const grab = document.createElement('button');
  grab.className = 'grab';
  grab.type = 'button';
  grab.textContent = 'Click to take the camera';
  stage.append(grab);
  stage.closest('.demo').classList.add('has-live');
  let frame = null;
  const mount = () => {
    const f = document.createElement('iframe');
    frame = f;
    f.title = 'Live demo of the Litescape viewer';
    f.inert = true;
    f.src = href;
    f.onload = () => setTimeout(() => frame === f && stage.classList.add('ready'), 600);
    stage.append(f);
  };
  const unmount = () => {
    frame?.remove();
    frame = null;
    stage.classList.remove('ready', 'active');
  };
  grab.onclick = () => {
    if (!frame) return;
    stage.classList.add('active');
    frame.inert = false;
    frame.focus();
  };
  stage.addEventListener('mouseleave', () => {
    stage.classList.remove('active');
    if (frame) frame.inert = true;
  });
  new IntersectionObserver(([e]) => (e.isIntersecting ? !frame && mount() : frame && unmount())).observe(stage);
}

for (const b of document.querySelectorAll('[data-copy]')) {
  const hint = b.querySelector('.copy-hint');
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.classList.add('done');
      hint.textContent = 'Copied';
    } catch {
      hint.textContent = 'Select and copy';
    }
    setTimeout(() => {
      b.classList.remove('done');
      hint.textContent = 'Copy';
    }, 1600);
  });
}

// Public configuration. Contains NO secrets.
// TURNSTILE_SITEKEY: real public site key for jayhasanmurugappan.github.io (public by design).
window.MESHGRID_CONFIG = {
  TURNSTILE_SITEKEY: "0x4AAAAAAFm4mleORhet_M69",
  // SHA-256 of "i4o-alliance|" + ACCESS CODE (upper-case). The code itself is not stored here.
  ACCESS_HASH: "0f466fe5943e0231eeaa991bd4d9c5bd38930b7635eabd0e03ffcbba4758eefa",
  // If Cloudflare cannot load (no internet at the venue), still allow the access code.
  ALLOW_OFFLINE_CODE: true,
  OWNER: "India 4.O Alliance"
};

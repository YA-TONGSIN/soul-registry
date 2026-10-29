// Static security checks for register/ (security review 2026-10-29).
// Chain notes, agent names and metaURIs are written by anyone, so the page must only ever put them in the DOM as text.
const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

const REG = path.join(__dirname, "..", "register");
const OWN_JS = fs.readdirSync(REG).filter((f) => f.endsWith(".js"));

describe("register/ static security", function () {
  it("own scripts use no HTML string sinks (innerHTML, outerHTML, insertAdjacentHTML, document.write, eval)", function () {
    for (const f of OWN_JS) {
      const src = fs.readFileSync(path.join(REG, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).to.not.match(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
    }
  });

  it("html pages load scripts from the same origin only, with a strict CSP meta", function () {
    for (const f of ["index.html", "donate.html"]) {
      const html = fs.readFileSync(path.join(REG, f), "utf8");
      expect(html, f).to.not.match(/<script(?![^>]*\bsrc=)[^>]*>/); // no inline scripts
      expect(html, f).to.not.match(/<script[^>]+src="(https?:)?\/\//);
      expect(html, f).to.match(/Content-Security-Policy" content="default-src 'none'; script-src 'self';/);
      expect(html, f).to.not.match(/\son[a-z]+="/); // no inline event handlers
    }
  });

  it("the public index.html CSP does not allow localhost (the e2e server adds it locally)", function () {
    const html = fs.readFileSync(path.join(REG, "index.html"), "utf8");
    const csp = (html.match(/Content-Security-Policy" content="([^"]*)"/) || [])[1] || "";
    expect(csp).to.match(/connect-src 'self'/);
    expect(csp).to.not.match(/localhost|127\.0\.0\.1/);
  });

  it("_headers sets anti-framing, nosniff and referrer policy", function () {
    const h = fs.readFileSync(path.join(REG, "_headers"), "utf8");
    expect(h).to.match(/X-Frame-Options: DENY/);
    expect(h).to.match(/frame-ancestors 'none'/);
    expect(h).to.match(/X-Content-Type-Options: nosniff/);
    expect(h).to.match(/Referrer-Policy: /);
  });

  it("the el() helper never turns an href/src into a script URL from chain text", function () {
    const app = fs.readFileSync(path.join(REG, "app.js"), "utf8");
    // every href built in app.js is a fixed prefix (mailto:, explorer + "/tx/", blob URL, config value) or an https URL checked by evidenceUrl()
    const hrefs = [...app.matchAll(/href:\s*([^,}]+)/g)].map((m) => m[1].trim());
    for (const h of hrefs) expect(h).to.match(/^("mailto:"|net\.explorer|URL\.createObjectURL|dState\.d\.page|u$)/);
    expect(app).to.match(/\^https:\\\/\\\/\[\^\\s\]\+\$/); // evidenceUrl only accepts https:// URLs
  });
});

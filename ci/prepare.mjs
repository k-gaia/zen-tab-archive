// Copies this repo's mod files into the test profile's sine-mods folder and
// writes the mods.json entry Sine would have written on a real install, so
// the CI run tests the same code a user gets -- minus Sine's GitHub-fetch
// install step, which is UI-driven and not worth scripting for a canary.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const profile = process.env.PROFILE_DIR;
if (!profile) throw new Error("PROFILE_DIR not set (setup.sh should export it)");

const theme = JSON.parse(readFileSync(join(repo, "theme.json"), "utf8"));
const modDir = join(profile, "chrome", "sine-mods", theme.id);
mkdirSync(modDir, { recursive: true });

for (const entry of ["theme.json", "preferences.json", "src"]) {
  cpSync(join(repo, entry), join(modDir, entry), { recursive: true });
}

const modsJsonPath = join(profile, "chrome", "sine-mods", "mods.json");
const mods = { [theme.id]: { ...theme, enabled: true, style: { chrome: "", content: "" } } };
writeFileSync(modsJsonPath, JSON.stringify(mods));

// Sine refuses to run scripts from non-store mods unless this pref is on.
writeFileSync(
  join(profile, "user.js"),
  [
    'user_pref("sine.allow-unsafe-js", true);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    "",
  ].join("\n"),
);

console.log(`Installed ${theme.id} into ${modDir}`);

import { build } from "esbuild";
await build({
  entryPoints: ["backend/apps-script.js"],
  bundle: true,
  format: "iife",
  globalName: "CTWA",
  target: "es2020",
  outfile: "apps-script/Code.gs",
  footer: {
    js: "function doPost(event) { return CTWA.handlePost(event); }\nfunction setup() { return CTWA.setup(); }\nfunction sendScheduledReminders() { return CTWA.sendScheduledReminders(); }",
  },
});
console.log("Generated apps-script/Code.gs");

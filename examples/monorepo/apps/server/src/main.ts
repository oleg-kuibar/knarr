import { renderButton, renderCard } from "@example/ui-kit";
import { formatDate, slugify, truncate } from "@mono/shared-utils";

console.log("=== @mono/shared-utils (workspace link) ===");
console.log(`  formatDate: ${formatDate(new Date())}`);
console.log(`  slugify:    ${slugify("Hello World Example")}`);
console.log(`  truncate:   ${truncate("This is a long string that should be truncated", 25)}`);

console.log("\n=== @example/ui-kit (Knarr-injected) ===");

const button = renderButton({ label: "Deploy", variant: "primary" });
console.log(`  Button:\n${button}`);

const card = renderCard({
  title: "Server Status",
  body: `Last checked: ${formatDate(new Date())}`,
  footer: button,
});
console.log(`  Card:\n${card}`);

console.log("\n--- server app is working with workspace + Knarr packages! ---");

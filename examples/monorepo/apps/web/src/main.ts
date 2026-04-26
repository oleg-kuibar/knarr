import { formatPrice, type Product } from "@example/api-client";
import { formatDate, slugify, truncate } from "@mono/shared-utils";

const product: Product = {
  id: "p1",
  name: "Wireless Headphones",
  price: 79.99,
  currency: "USD",
  inStock: true,
};

const app = document.getElementById("app")!;

app.innerHTML = `
  <h1>monorepo web — Knarr demo</h1>
  <h2>@example/api-client (Knarr-injected)</h2>
  <p>Product: ${product.name} — ${formatPrice(product)}</p>
  <h2>@mono/shared-utils (workspace link)</h2>
  <ul>
    <li>formatDate: ${formatDate(new Date())}</li>
    <li>slugify: ${slugify(product.name)}</li>
    <li>truncate: ${truncate("This is a long product description that should be cut off", 30)}</li>
  </ul>
`;

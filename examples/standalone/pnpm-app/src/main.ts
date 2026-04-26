import { formatPrice, type Product } from "@example/api-client";
import { renderButton, renderCard } from "@example/ui-kit";

const product: Product = {
  id: "p1",
  name: "Wireless Headphones",
  price: 79.99,
  currency: "USD",
  inStock: true,
};

const app = document.getElementById("app")!;

const card = renderCard({
  title: product.name,
  body: `Price: ${formatPrice(product)}`,
  footer: renderButton({ label: "Buy Now", variant: "primary" }),
});

app.innerHTML = `
  <h1>pnpm-app — Knarr demo</h1>
  <p>Product: ${product.name} — ${formatPrice(product)}</p>
  ${card}
`;

import { formatPrice, type User, type Product } from "@example/api-client";
import { renderButton, renderCard } from "@example/ui-kit";

const user: User = {
  id: "1",
  name: "Alice",
  email: "alice@example.com",
  role: "admin",
  createdAt: new Date().toISOString(),
};

const product: Product = {
  id: "p1",
  name: "Wireless Headphones",
  price: 79.99,
  currency: "USD",
  inStock: true,
};

console.log(`User: ${user.name} (${user.role})`);
console.log(`Product: ${product.name} — ${formatPrice(product)}`);

const buyButton = renderButton({
  label: "Buy Now",
  variant: "primary",
});

const productCard = renderCard({
  title: product.name,
  body: `Price: ${formatPrice(product)}`,
  footer: buyButton,
});

console.log("\nRendered product card:");
console.log(productCard);

console.log("\n--- bun-app is working with Knarr-linked packages! ---");

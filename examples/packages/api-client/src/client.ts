import type { ApiResponse, User, Product } from "./types.js";

const API_BASE = "https://api.example.com";

/** Fetch a user by ID */
export async function getUser(id: string): Promise<ApiResponse<User>> {
  const res = await fetch(`${API_BASE}/users/${id}`);
  return res.json() as Promise<ApiResponse<User>>;
}

/** Fetch all products */
export async function getProducts(): Promise<ApiResponse<Product[]>> {
  const res = await fetch(`${API_BASE}/products`);
  return res.json() as Promise<ApiResponse<Product[]>>;
}

/** Format a price for display */
export function formatPrice(product: Product): string {
  return `${product.currency} ${product.price.toFixed(2)}`;
}

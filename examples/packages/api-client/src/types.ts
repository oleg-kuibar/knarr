/** Standard API response wrapper */
export interface ApiResponse<T> {
  data: T;
  status: number;
  message: string;
}

/** User entity from the backend */
export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user" | "guest";
  createdAt: string;
}

/** Product entity from the backend */
export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  inStock: boolean;
}

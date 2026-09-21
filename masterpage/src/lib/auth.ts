import { SignJWT, jwtVerify } from "jose";
import type { Role, User } from "@/types";

const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-change-me");

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

export async function signSession(user: User) {
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

export function canAccess(role: Role, area: "admin" | "allocate" | "audit" | "upload") {
  if (role === "ADMIN") return true;
  if (area === "admin") return false;
  if (area === "allocate") return role === "MANAGER";
  if (area === "audit") return role === "QUALITY_AUDITOR" || role === "MANAGER";
  if (area === "upload") return role === "MANAGER";
  return role !== "VIEWER";
}

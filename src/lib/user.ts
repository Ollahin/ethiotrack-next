import { useEffect, useState } from "react";
import { metaGet, metaSet } from "./db";

const USER_NAME_KEY = "user_name_v1";
const USER_PROFILE_KEY = "user_profile_v1";

export type UserProfile = {
  name: string;
  phone?: string;
  email?: string;
  businessName?: string;
  role?: string;
};

const listeners = new Set<(name: string | null) => void>();
function emit(name: string | null) { for (const l of listeners) l(name); }

const profileListeners = new Set<(p: UserProfile | null) => void>();
function emitProfile(p: UserProfile | null) { for (const l of profileListeners) l(p); }

export async function getUserName(): Promise<string | null> {
  return (await metaGet<string>(USER_NAME_KEY)) ?? null;
}

export async function setUserName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name cannot be empty");
  if (trimmed.length > 60) throw new Error("Name must be 60 characters or less");
  await metaSet(USER_NAME_KEY, trimmed);
  emit(trimmed);
  const existing = (await metaGet<UserProfile>(USER_PROFILE_KEY)) ?? { name: trimmed };
  const next = { ...existing, name: trimmed };
  await metaSet(USER_PROFILE_KEY, next);
  emitProfile(next);
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const p = await metaGet<UserProfile>(USER_PROFILE_KEY);
  if (p && p.name) return p;
  const n = await getUserName();
  return n ? { name: n } : null;
}

function optionalString(value: string | undefined, field: string, max: number): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new Error(`${field} must be ${max} characters or less`);
  return trimmed;
}

export async function setUserProfile(input: UserProfile): Promise<UserProfile> {
  const name = input.name.trim();
  if (!name) throw new Error("Name cannot be empty");
  if (name.length > 60) throw new Error("Name must be 60 characters or less");

  const phone = optionalString(input.phone, "Phone", 32);
  if (phone && !/^[+()\-\s\d]{5,32}$/.test(phone)) throw new Error("Enter a valid phone number");

  const email = optionalString(input.email, "Email", 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email");

  const businessName = optionalString(input.businessName, "Business name", 80);
  const role = optionalString(input.role, "Role", 60);

  const next: UserProfile = { name, phone, email, businessName, role };
  await metaSet(USER_PROFILE_KEY, next);
  await metaSet(USER_NAME_KEY, name);
  emit(name);
  emitProfile(next);
  return next;
}

export function useUserProfile(): UserProfile | null {
  const [p, setP] = useState<UserProfile | null>(null);
  useEffect(() => {
    let alive = true;
    getUserProfile().then((v) => { if (alive) setP(v); });
    const l = (v: UserProfile | null) => setP(v);
    profileListeners.add(l);
    return () => { alive = false; profileListeners.delete(l); };
  }, []);
  return p;
}

export function useUserName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getUserName().then((n) => { if (alive) setName(n); });
    const l = (n: string | null) => setName(n);
    listeners.add(l);
    return () => { alive = false; listeners.delete(l); };
  }, []);
  return name;
}

export function firstName(full: string | null): string {
  if (!full) return "";
  return full.split(/\s+/)[0] ?? "";
}
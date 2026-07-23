import { useEffect, useState } from "react";
import { metaGet, metaSet } from "./db";

const USER_NAME_KEY = "user_name_v1";

const listeners = new Set<(name: string | null) => void>();
function emit(name: string | null) { for (const l of listeners) l(name); }

export async function getUserName(): Promise<string | null> {
  return (await metaGet<string>(USER_NAME_KEY)) ?? null;
}

export async function setUserName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name cannot be empty");
  if (trimmed.length > 60) throw new Error("Name must be 60 characters or less");
  await metaSet(USER_NAME_KEY, trimmed);
  emit(trimmed);
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
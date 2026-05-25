"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function SettingsFieldsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/data-studio?tab=field-settings"); }, [router]);
  return null;
}

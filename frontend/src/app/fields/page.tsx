"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function FieldsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/data-studio?tab=fields"); }, [router]);
  return null;
}

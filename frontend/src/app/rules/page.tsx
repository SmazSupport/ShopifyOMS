"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function RulesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/data-studio?tab=transforms"); }, [router]);
  return null;
}

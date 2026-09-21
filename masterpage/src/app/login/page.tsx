"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { demoStore } from "@/lib/demo-store";

export default function LoginPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#111827] px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Toyota BO & Stock</CardTitle>
          <CardDescription>Internal sign-in — demo users preloaded</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <Select id="email" defaultValue="admin@toyota.sa">
              {demoStore.getUsers().map((u) => (
                <option key={u.id} value={u.email}>
                  {u.name} ({u.role})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <Input defaultValue="demo1234" type="password" />
          </div>
          <Button className="w-full" onClick={() => router.push("/dashboard")}>
            Sign in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

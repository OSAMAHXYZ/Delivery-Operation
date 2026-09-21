"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PreviewRow = Record<string, string | number>;

export default function DataUploadPage() {
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  async function onFile(file: File) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<PreviewRow>(sheet).slice(0, 20);
    setPreview(rows);

    const issues: string[] = [];
    rows.forEach((row, index) => {
      if (!row.VIN && !row["BO Number"]) issues.push(`Row ${index + 2}: missing VIN or BO Number`);
    });

    setErrors(issues);
    setSummary([
      `Records detected: ${rows.length}`,
      `Records imported: ${issues.length ? 0 : rows.length}`,
      `Records rejected: ${issues.length}`,
      `Validation errors: ${issues.length}`,
    ]);
  }

  return (
    <AppShell title="Data Upload" subtitle="Import Stock, Back Orders, Sales, and Cancelled BO from Excel">
      <Card>
        <CardHeader>
          <CardTitle>Upload Excel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          {summary.length ? (
            <ul className="rounded-xl bg-slate-50 p-4 text-sm">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {errors.length ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {errors.map((err) => (
                <p key={err}>{err}</p>
              ))}
            </div>
          ) : null}
          {preview.length ? (
            <>
              <p className="text-sm font-semibold">Preview (first 20 rows)</p>
              <div className="overflow-auto rounded-xl border">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr>
                      {Object.keys(preview[0]).map((key) => (
                        <th key={key} className="border-b px-2 py-2 text-left">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val, j) => (
                          <td key={j} className="border-b px-2 py-2">
                            {String(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button disabled={errors.length > 0}>Import validated records</Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}

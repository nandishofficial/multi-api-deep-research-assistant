import { authedRoute } from "@/server/http";
import { renderReportPdf, reportFilename } from "@/server/report/pdf";
import { loadReportData } from "@/server/research/report-data";
import * as repo from "@/server/research/repository";
import { HttpError } from "@/server/research/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Serves the PDF report, regenerated on demand from the stored results. `?download=1` forces a download. */
export const GET = authedRoute<{ id: string }>(async ({ request, user, params }) => {
  const row = await repo.getResearchForUser(params.id, user.id);
  if (!row) throw new HttpError(404, "Research not found");
  const runs = await repo.getRuns(row.id);
  if (!runs.some((r) => r.status === "completed")) throw new HttpError(409, "The report is not ready yet");
  const data = await loadReportData(row.id);
  if (!data) throw new HttpError(404, "Research not found");
  const pdf = await renderReportPdf(data);
  const filename = reportFilename(data.title, data.generatedAt);
  const disposition = new URL(request.url).searchParams.has("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});

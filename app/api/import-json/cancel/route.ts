import { NextResponse } from "next/server";

// Import the runningWorkers map from the main import-json route

import { requestCancelFile } from "@/utils/import-cancel-file";

export async function POST(req: Request) {
  try {
    const { taskId } = await req.json();
    if (!taskId) return NextResponse.json({ message: "Missing taskId" }, { status: 400 });
    // Set cancel token via file
    requestCancelFile(taskId);
    return NextResponse.json({ message: "Cancel requested (file token)", taskId });
  } catch (err: any) {
    return NextResponse.json({ message: err?.message || "Internal error" }, { status: 500 });
  }
}

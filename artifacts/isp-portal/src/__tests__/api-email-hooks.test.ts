import { describe, expect, it } from "vitest";
import {
  getGetWelcomeEmailPreviewQueryKey,
  useGetSettings,
  useGetWelcomeEmailPreview,
  useSendTestEmail,
  useSendWelcomeEmailTest,
  useUpdateSettings,
} from "@workspace/api-client-react";

describe("email API client hooks", () => {
  it("exports the Staff and Settings page hooks from the generated client", () => {
    expect(useGetWelcomeEmailPreview).toBeTypeOf("function");
    expect(useSendWelcomeEmailTest).toBeTypeOf("function");
    expect(useGetSettings).toBeTypeOf("function");
    expect(useUpdateSettings).toBeTypeOf("function");
    expect(useSendTestEmail).toBeTypeOf("function");
    expect(getGetWelcomeEmailPreviewQueryKey()).toEqual([
      "/api/users/welcome-email-preview",
    ]);
  });
});
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CircleAlert } from "lucide-react";

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useIdleLogout } from '@/hooks/useIdleLogout';

export function IdleLogoutDialog() {
  const { showWarning, secondsRemaining, stayActive } = useIdleLogout();

  return (
    <AlertDialog open={showWarning} onOpenChange={(open) => !open && stayActive()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You&apos;ll be signed out soon</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ve been inactive for a while — you&apos;ll be signed out in {secondsRemaining}s due
            to inactivity.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={stayActive}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

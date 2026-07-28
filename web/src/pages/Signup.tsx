// web/src/pages/Signup.tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/Logo';
import { supabase } from '@/lib/supabaseClient';

export function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setIsSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (!data.session) {
      setConfirmationSent(true);
      return;
    }
    navigate('/dashboard');
  }

  if (confirmationSent) {
    return (
      <div className="card-surface mx-auto mt-8 max-w-sm p-8">
        <Logo size={40} className="mb-6" />
        <h1 className="mb-6 text-2xl font-extrabold">Sign Up</h1>
        <p className="text-sm">
          We sent a confirmation link to {email}. Check your email to confirm your account before logging in.
        </p>
        <Link to="/login" className="text-muted-foreground mt-4 inline-block text-sm hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="card-surface mx-auto mt-8 max-w-sm p-8">
      <Logo size={40} className="mb-6" />
      <h1 className="mb-6 text-2xl font-extrabold">Sign Up</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing up…' : 'Sign up'}
        </Button>
        <Link to="/login" className="text-muted-foreground text-sm hover:underline">
          Already have an account? Log in
        </Link>
      </form>
    </div>
  );
}

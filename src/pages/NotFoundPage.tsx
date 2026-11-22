import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-4xl font-semibold text-brand">404</h1>
      <p className="mt-2 text-sub">This page hopped away.</p>
      <Link to="/" className="mt-6 inline-block text-brand underline">Back to typing</Link>
    </div>
  );
}

import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import ResultsView from '../components/ResultsView';
import { useProgress } from '../state/store';

export default function HistoryDetailPage() {
  const { id } = useParams();
  const test = useProgress().history.find((t) => t.id === id);
  return (
    <div>
      <Link to="/stats" className="mb-6 inline-flex items-center gap-1 text-sm text-sub hover:text-text">
        <ArrowLeft size={16} /> Statistics
      </Link>
      {test ? (
        <>
          <p className="mb-4 text-sm text-sub">{new Date(test.createdAt).toLocaleString()}</p>
          <ResultsView result={test} />
        </>
      ) : (
        <p className="text-sub">Test not found.</p>
      )}
    </div>
  );
}

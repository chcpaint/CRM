import { useState, useRef, useEffect } from 'react';
import { api } from '../../services/api';
import { useVoiceNavigation, VoiceFollowUp } from '../../hooks/useVoiceNavigation';
import { Account, Note, STATUS_COLORS } from '../../types';

interface AISearchBarProps {
  onNavigate: (path: string) => void;
}

export default function AISearchBar({ onNavigate }: AISearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [resultType, setResultType] = useState<string>('accounts');
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
  };

  // Handle voice follow-up creation
  const handleVoiceFollowUp = async (followUp: VoiceFollowUp) => {
    try {
      const data = await api.post('/voice-follow-up', {
        account_name: followUp.accountName,
        follow_up_date: followUp.date,
        notes: followUp.notes
      });
      const friendlyDate = new Date(followUp.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      showToast(`Follow-up set for ${data.shop_name} on ${friendlyDate}${followUp.notes ? ` — ${followUp.notes}` : ''}`);
    } catch (err: any) {
      showToast(err.error || 'Could not create follow-up', 'error');
    }
  };

  // Unified voice: uses voice navigation hook which handles nav, customer lookup, search, etc.
  const { isListening, feedback, startListening, stopListening, isSupported } = useVoiceNavigation(
    (path) => {
      setQuery('');
      setShowResults(false);
      onNavigate(path);
    },
    (searchQuery) => {
      // Voice search fallback — run it through the AI search
      setQuery(searchQuery);
      runSearch(searchQuery);
    },
    handleVoiceFollowUp
  );

  // Close results on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    setIsSearching(true);
    setShowResults(true);
    try {
      const data = await api.post('/search', { query: q.trim() });
      setResults(data.results || []);
      setResultType(data.type || 'accounts');
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = async () => {
    await runSearch(query);
    // Clear query after executing
    setTimeout(() => setQuery(''), 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
    if (e.key === 'Escape') setShowResults(false);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className={`flex items-center bg-navy-800 rounded-lg border transition-colors overflow-hidden ${
        isListening ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-navy-700 focus-within:border-brand-500'
      }`}>
        {/* Search icon */}
        <svg className="w-4 h-4 text-navy-400 ml-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setShowResults(true)}
          placeholder={isListening ? 'Listening...' : 'Search or say a command...'}
          className="flex-1 bg-transparent text-white text-sm px-2 sm:px-3 py-2 outline-none placeholder-navy-400 min-w-0"
        />
        {/* Single unified mic button */}
        {isSupported && (
          <button
            onClick={isListening ? stopListening : startListening}
            className={`p-2 rounded-lg mr-1 transition-all flex-shrink-0 ${
              isListening
                ? 'text-white bg-brand-500 shadow-lg shadow-brand-500/30'
                : 'text-navy-400 hover:text-white hover:bg-navy-700'
            }`}
            title={isListening ? 'Stop listening' : 'Voice command — say "dashboard", "parliament invoices", etc.'}
          >
            {isListening ? (
              <div className="relative">
                <span className="absolute inset-0 rounded-full bg-brand-400 animate-ping opacity-40" />
                <svg className="w-4 h-4 relative" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              </div>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={handleSearch}
          disabled={isSearching}
          className="text-sm text-navy-300 hover:text-white px-2 sm:px-3 py-2 border-l border-navy-700 flex-shrink-0 whitespace-nowrap"
        >
          {isSearching ? '...' : 'Go'}
        </button>
      </div>

      {/* Voice feedback toast */}
      {feedback && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-navy-800 text-white text-xs px-3 py-2 rounded-lg shadow-xl z-50 border border-navy-700 text-center">
          {feedback}
        </div>
      )}

      {/* Results dropdown */}
      {showResults && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border border-navy-200 max-h-96 overflow-y-auto z-50">
          <div className="p-2 text-xs text-navy-500 border-b border-navy-100 flex justify-between">
            <span>{results.length} {resultType} found</span>
            <button onClick={() => setShowResults(false)} className="text-navy-400 hover:text-navy-600">Close</button>
          </div>
          {results.map((result: any, idx: number) => (
            <button
              key={idx}
              onClick={() => {
                if (resultType === 'accounts') {
                  onNavigate(`/accounts/${result.id}`);
                } else if (resultType === 'sales_customers') {
                  // Navigate to sales page filtered by this customer
                  if (result.account_id) {
                    onNavigate(`/sales?customer=${encodeURIComponent(result.customer_name)}`);
                  } else {
                    onNavigate(`/sales?customer=${encodeURIComponent(result.customer_name)}`);
                  }
                } else {
                  onNavigate(`/accounts/${result.account_id}`);
                }
                setShowResults(false);
                setQuery('');
              }}
              className="w-full text-left px-4 py-3 hover:bg-navy-50 border-b border-navy-50 transition-colors"
            >
              {resultType === 'accounts' ? (
                <div>
                  <div className="font-medium text-navy-900 text-sm">{result.shop_name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-navy-500">{result.city || 'No city'}</span>
                    <span className={`badge ${STATUS_COLORS[result.status as keyof typeof STATUS_COLORS] || 'badge-prospect'}`}>
                      {result.status}
                    </span>
                    {result.rep_first_name && (
                      <span className="text-xs text-navy-400">Rep: {result.rep_first_name}</span>
                    )}
                  </div>
                </div>
              ) : resultType === 'sales_customers' ? (
                <div>
                  <div className="font-medium text-navy-900 text-sm">{result.customer_name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-medium text-green-600">
                      ${result.total_revenue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'} revenue
                    </span>
                    <span className="text-xs text-navy-500">{result.sale_count} sale{result.sale_count !== 1 ? 's' : ''}</span>
                    <span className="badge badge-active">Sales Customer</span>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="font-medium text-navy-900 text-sm">{result.shop_name}</div>
                  <div className="text-xs text-navy-600 mt-1 line-clamp-2">{result.content}</div>
                  <div className="text-xs text-navy-400 mt-1">by {result.first_name} {result.last_name}</div>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {showResults && results.length === 0 && !isSearching && query.trim() && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border border-navy-200 p-6 text-center z-50">
          <p className="text-navy-500 text-sm">No results found for "{query}"</p>
          <p className="text-navy-400 text-xs mt-1">Try: "prospects in Hamilton" or "former Sherwin clients"</p>
        </div>
      )}

      {/* Follow-up toast confirmation */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 max-w-sm w-full px-4 py-3 rounded-xl shadow-2xl z-[100] text-sm font-medium animate-slide-down ${
          toast.type === 'success'
            ? 'bg-green-600 text-white'
            : 'bg-red-500 text-white'
        }`}>
          <div className="flex items-center gap-2">
            <span>{toast.type === 'success' ? '\u2713' : '\u2717'}</span>
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToast(null)} className="text-white/70 hover:text-white">&times;</button>
          </div>
        </div>
      )}
    </div>
  );
}

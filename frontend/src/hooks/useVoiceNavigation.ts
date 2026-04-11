import { useState, useCallback, useRef, useEffect } from 'react';

interface VoiceNavResult {
  command: string;
  path?: string;
  search?: string;
}

export interface VoiceFollowUp {
  accountName: string;
  date: string; // YYYY-MM-DD
  notes: string;
}

interface UseVoiceNavigationReturn {
  isListening: boolean;
  lastCommand: string;
  feedback: string;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
}

// ─── Date parsing helper ───
function parseNaturalDate(text: string): string | null {
  const now = new Date();
  const currentYear = now.getFullYear();

  // "today"
  if (/\btoday\b/i.test(text)) {
    return formatDate(now);
  }

  // "tomorrow"
  if (/\btomorrow\b/i.test(text)) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    return formatDate(d);
  }

  // "next week" / "next monday" etc.
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const nextDayMatch = text.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week)\b/i);
  if (nextDayMatch) {
    if (nextDayMatch[1].toLowerCase() === 'week') {
      const d = new Date(now); d.setDate(d.getDate() + 7);
      return formatDate(d);
    }
    const targetDay = dayNames.indexOf(nextDayMatch[1].toLowerCase());
    const d = new Date(now);
    const diff = (targetDay - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return formatDate(d);
  }

  // "in X days/weeks"
  const inMatch = text.match(/\bin\s+(\d+)\s+(days?|weeks?|months?)\b/i);
  if (inMatch) {
    const n = parseInt(inMatch[1]);
    const d = new Date(now);
    if (/day/i.test(inMatch[2])) d.setDate(d.getDate() + n);
    else if (/week/i.test(inMatch[2])) d.setDate(d.getDate() + n * 7);
    else if (/month/i.test(inMatch[2])) d.setMonth(d.getMonth() + n);
    return formatDate(d);
  }

  // Month day, year — "december 12 2026", "dec 12", "january 5th"
  const months: Record<string, number> = {
    january:0, february:1, march:2, april:3, may:4, june:5,
    july:6, august:7, september:8, october:9, november:10, december:11,
    jan:0, feb:1, mar:2, apr:3, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11
  };
  const monthMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})?\b/i);
  if (monthMatch) {
    const month = months[monthMatch[1].toLowerCase()];
    const day = parseInt(monthMatch[2]);
    const year = monthMatch[3] ? parseInt(monthMatch[3]) : (month < now.getMonth() || (month === now.getMonth() && day < now.getDate())) ? currentYear + 1 : currentYear;
    return formatDate(new Date(year, month, day));
  }

  // MM/DD or MM/DD/YYYY
  const slashMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (slashMatch) {
    const m = parseInt(slashMatch[1]) - 1;
    const d = parseInt(slashMatch[2]);
    let y = slashMatch[3] ? parseInt(slashMatch[3]) : currentYear;
    if (y < 100) y += 2000;
    return formatDate(new Date(y, m, d));
  }

  return null;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const NAV_ROUTES: { patterns: RegExp[]; path: string; label: string }[] = [
  { patterns: [/\b(dashboard|home|main|overview)\b/i], path: '/', label: 'Dashboard' },
  { patterns: [/\b(show|list|view|open|go\s*to)\s+(all\s+)?(accounts?|shops?|contacts?|customers?)\b/i, /^(accounts?|shops?|contacts?|customers?)$/i], path: '/accounts', label: 'Accounts' },
  { patterns: [/\b(show|go\s*to|open)\s+(all\s+)?(sales|revenue)\b/i, /^(sales|revenue|money|imports?)$/i], path: '/sales', label: 'Sales' },
  { patterns: [/\b(admin|settings?|users?|team)\b/i], path: '/admin', label: 'Admin' },
];

const SEARCH_PATTERNS = [
  /\b(?:search|find|look\s*up|show\s*me)\s+(.+)/i,
  /\b(?:who|where|what)(?:'s|s)?\s+(.+)/i,
];

const ACCOUNT_PATTERN = /\b(?:open|go\s*to|show|pull\s*up|view)\s+(.+?)(?:\s+account)?$/i;

// Patterns for sales/invoice customer lookups
const SALES_CUSTOMER_PATTERNS = [
  /\b(.+?)\s+(?:invoices?|sales|revenue|transactions?|orders?)\b/i,
  /\b(?:invoices?|sales|revenue|transactions?|orders?)\s+(?:for|from|of)\s+(.+)/i,
  /\b(?:show|pull\s*up|view|get|find)\s+(.+?)\s+(?:invoices?|sales|revenue|transactions?)\b/i,
];

// Patterns for salesperson lookups
const SALESPERSON_PATTERNS = [
  /\b(.+?)(?:'s|s)\s+(?:sales|revenue|numbers?|accounts?|customers?|invoices?)\b/i,
  /\b(?:sales|revenue|numbers?|invoices?)\s+(?:for|from|by)\s+(.+)/i,
];

export function useVoiceNavigation(
  onNavigate: (path: string) => void,
  onSearch?: (query: string) => void,
  onFollowUp?: (followUp: VoiceFollowUp) => void
): UseVoiceNavigationReturn {
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState('');
  const [feedback, setFeedback] = useState('');
  const recognitionRef = useRef<any>(null);
  const feedbackTimeoutRef = useRef<any>(null);

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const isSupported = !!SpeechRecognition;

  // Cleanup on unmount — prevents Safari from hanging with orphaned recognition sessions
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) { /* ignore */ }
        recognitionRef.current = null;
      }
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setFeedback(''), 3000);
  }, []);

  const processCommand = useCallback((text: string) => {
    const cleaned = text.trim().toLowerCase();
    setLastCommand(cleaned);

    // Check navigation routes
    for (const route of NAV_ROUTES) {
      for (const pattern of route.patterns) {
        if (pattern.test(cleaned)) {
          showFeedback(`Going to ${route.label}`);
          onNavigate(route.path);
          return;
        }
      }
    }

    // Check for salesperson lookup (e.g. "Ben's sales", "revenue for Michelle")
    for (const pattern of SALESPERSON_PATTERNS) {
      const match = cleaned.match(pattern);
      const repName = (match?.[1] || match?.[2] || '').trim();
      if (repName && repName.length > 1) {
        showFeedback(`Showing sales by "${repName}"`);
        onNavigate(`/sales?rep=${encodeURIComponent(repName)}`);
        return;
      }
    }

    // Check for sales/invoice customer lookup (e.g. "parliament auto body invoices")
    for (const pattern of SALES_CUSTOMER_PATTERNS) {
      const match = cleaned.match(pattern);
      const customerName = (match?.[1] || match?.[2] || '').trim();
      if (customerName && customerName.length > 2) {
        showFeedback(`Showing sales for "${customerName}"`);
        onNavigate(`/sales?customer=${encodeURIComponent(customerName)}`);
        return;
      }
    }

    // Check for follow-up creation (e.g. "follow up Complete Auto Body december 12 bring donuts")
    // Also catches: "meeting with ...", "appointment with ...", "schedule meeting ..."
    if (/\b(follow[\s-]?up|meeting|appointment)\b/i.test(cleaned) && onFollowUp) {
      // Remove the trigger keywords and common filler words
      const withoutFollowUp = cleaned
        .replace(/\b(follow[\s-]?up|meeting|appointment|with|for|on|at|set|schedule|create|add|book|a|an|the|and|to)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Try to extract date from the text
      const dateStr = parseNaturalDate(withoutFollowUp);

      if (dateStr) {
        // Remove date-related text to isolate shop name and notes
        let remaining = withoutFollowUp
          // Remove month + day + year patterns
          .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{0,4}/gi, '|||')
          // Remove "today", "tomorrow", "next X", "in X days"
          .replace(/\b(today|tomorrow)\b/gi, '|||')
          .replace(/\bnext\s+\w+\b/gi, '|||')
          .replace(/\bin\s+\d+\s+\w+\b/gi, '|||')
          // Remove MM/DD patterns
          .replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g, '|||')
          .replace(/\s+/g, ' ')
          .trim();

        // Split on the date marker — before is shop name, after is notes
        const parts = remaining.split('|||').map(s => s.trim()).filter(Boolean);
        const accountName = parts[0] || '';
        const notes = parts.slice(1).join(' ').trim();

        if (accountName.length > 1) {
          const friendlyDate = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          showFeedback(`Setting follow-up: "${accountName}" on ${friendlyDate}`);
          onFollowUp({ accountName, date: dateStr, notes });
          return;
        }
      }
    }

    // Check for search commands
    for (const pattern of SEARCH_PATTERNS) {
      const match = cleaned.match(pattern);
      if (match && match[1]) {
        const query = match[1].trim();
        showFeedback(`Searching: "${query}"`);
        if (onSearch) {
          onSearch(query);
        } else {
          onNavigate(`/accounts?search=${encodeURIComponent(query)}`);
        }
        return;
      }
    }

    // Check for specific account navigation
    const accountMatch = cleaned.match(ACCOUNT_PATTERN);
    if (accountMatch && accountMatch[1]) {
      const name = accountMatch[1].trim();
      showFeedback(`Looking up "${name}"`);
      onNavigate(`/accounts?search=${encodeURIComponent(name)}`);
      return;
    }

    // Check for follow-up commands
    if (/\b(follow[\s-]?ups?|reminders?|upcoming|overdue)\b/i.test(cleaned)) {
      showFeedback('Going to Dashboard (follow-ups)');
      onNavigate('/');
      return;
    }

    // Check for dormant/inactive
    if (/\b(dormant|inactive|haven't contacted|overdue)\b/i.test(cleaned)) {
      showFeedback('Searching dormant accounts');
      if (onSearch) {
        onSearch('dormant accounts');
      } else {
        onNavigate('/accounts?search=dormant');
      }
      return;
    }

    // Check for add/create commands
    if (/\b(add|create|new)\s+(account|shop|contact)\b/i.test(cleaned)) {
      showFeedback('Opening Accounts to add new');
      onNavigate('/accounts?action=add');
      return;
    }

    // Fallback: treat as search
    if (cleaned.length > 2) {
      showFeedback(`Searching: "${cleaned}"`);
      if (onSearch) {
        onSearch(cleaned);
      } else {
        onNavigate(`/accounts?search=${encodeURIComponent(cleaned)}`);
      }
    } else {
      showFeedback("Didn't catch that. Try: 'go to dashboard' or 'find Maple Leaf'");
    }
  }, [onNavigate, onSearch, onFollowUp, showFeedback]);

  const startListening = useCallback(() => {
    if (!isSupported) return;

    // Abort any existing session first (Safari can't handle multiple)
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) { /* ignore */ }
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setFeedback('Listening... say a command');
      };

      recognition.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        processCommand(text);
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          showFeedback(`Voice error: ${event.error}`);
        }
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      showFeedback('Could not start voice recognition');
      setIsListening(false);
    }
  }, [isSupported, processCommand, showFeedback]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      // Use abort() instead of stop() — abort() is immediate and reliable on Safari
      try { recognitionRef.current.abort(); } catch (_) { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setFeedback('');
  }, []);

  return { isListening, lastCommand, feedback, startListening, stopListening, isSupported };
}

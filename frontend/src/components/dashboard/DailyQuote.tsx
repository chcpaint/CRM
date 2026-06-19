import { useState, useEffect } from 'react';

// Curated quotes — sales motivation, business wisdom, and conversation-starters.
// Rotates daily based on the date so everyone on the team sees the same quote.
const QUOTES: { text: string; author: string }[] = [
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Every sale has five basic obstacles: no need, no money, no hurry, no desire, no trust.", author: "Zig Ziglar" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "Quality performance starts with a positive attitude.", author: "Jeffrey Gitomer" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
  { text: "The best way to predict the future is to create it.", author: "Peter Drucker" },
  { text: "Your attitude, not your aptitude, will determine your altitude.", author: "Zig Ziglar" },
  { text: "I never dreamed about success, I worked for it.", author: "Estée Lauder" },
  { text: "The harder the conflict, the more glorious the triumph.", author: "Thomas Paine" },
  { text: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
  { text: "If you really look closely, most overnight successes took a long time.", author: "Steve Jobs" },
  { text: "Don't be afraid to give up the good to go for the great.", author: "John D. Rockefeller" },
  { text: "People don't buy for logical reasons. They buy for emotional reasons.", author: "Zig Ziglar" },
  { text: "Become the person who would attract the results you seek.", author: "Jim Cathcart" },
  { text: "Motivation is what gets you started. Habit is what keeps you going.", author: "Jim Ryun" },
  { text: "Sales are contingent upon the attitude of the salesman, not the attitude of the prospect.", author: "W. Clement Stone" },
  { text: "Setting goals is the first step in turning the invisible into the visible.", author: "Tony Robbins" },
  { text: "It's not about having the right opportunities. It's about handling the opportunities right.", author: "Mark Hunter" },
  { text: "The difference between a successful person and others is not a lack of strength, but a lack of will.", author: "Vince Lombardi" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
  { text: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "What you do today can improve all your tomorrows.", author: "Ralph Marston" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Everything you've ever wanted is sitting on the other side of fear.", author: "George Addair" },
  { text: "The key is not to call the decision maker. The key is to have the decision maker call you.", author: "Jeffrey Gitomer" },
  { text: "Make a customer, not a sale.", author: "Katherine Barchetti" },
  { text: "There is no traffic jam along the extra mile.", author: "Roger Staubach" },
];

// Fun facts — conversation starters for the sales team
const FUN_FACTS: string[] = [
  "The auto body industry in North America is worth over $50 billion annually.",
  "The average car has about 30,000 parts — each one a potential sale.",
  "Waterborne basecoats now make up over 80% of automotive refinish in North America.",
  "The first automotive paint spray gun was invented in 1888 by Dr. Allen DeVilbiss.",
  "A typical collision repair uses 15-20 different products from mixing to clearcoat.",
  "PPG Industries produces enough paint each year to cover over 1 billion square feet.",
  "The human eye can distinguish about 10 million different colors — your customers notice every shade.",
  "80% of sales require 5 follow-up calls after the meeting, but 44% of salespeople give up after one.",
  "Referrals convert at 3-5x the rate of other leads. Your best customers are your best salespeople.",
  "The word 'customer' comes from the Latin 'consuetudinem' meaning habit. Build habits, build loyalty.",
  "Cars today use an average of 13 different types of materials, each requiring different prep techniques.",
  "The average collision repair now takes about 5.4 days — down from 7+ days a decade ago.",
  "Studies show customers who feel valued spend 23% more. A simple follow-up call goes a long way.",
  "The color white has been the world's most popular car color for over a decade straight.",
  "Top-performing salespeople spend 6 hours per week researching their prospects.",
];

function getDailyIndex(listLength: number): number {
  // Use the date as a seed so the quote rotates daily and everyone sees the same one
  const now = new Date();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
  );
  return (dayOfYear + now.getFullYear()) % listLength;
}

export default function DailyQuote() {
  const [visible, setVisible] = useState(true);
  const [isQuote, setIsQuote] = useState(true);
  const [content, setContent] = useState({ text: '', author: '' });

  useEffect(() => {
    // Alternate between quotes and fun facts based on the day
    const dayIdx = getDailyIndex(QUOTES.length + FUN_FACTS.length);
    if (dayIdx < QUOTES.length) {
      setIsQuote(true);
      setContent(QUOTES[dayIdx]);
    } else {
      setIsQuote(false);
      const factIdx = dayIdx - QUOTES.length;
      setContent({ text: FUN_FACTS[factIdx], author: '' });
    }
  }, []);

  if (!visible || !content.text) return null;

  return (
    <div className="mb-4 sm:mb-6 animate-fade-in">
      <div className="glass-elevated px-5 py-4 flex items-start gap-3 group">
        <div className="flex-shrink-0 mt-0.5">
          {isQuote ? (
            <svg className="w-5 h-5 text-brand-500/70" fill="currentColor" viewBox="0 0 24 24">
              <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-amber-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-navy-700 leading-relaxed italic">
            {isQuote ? `"${content.text}"` : content.text}
          </p>
          {content.author && (
            <p className="text-xs text-navy-400 mt-1.5 font-medium">— {content.author}</p>
          )}
        </div>
        <button
          onClick={() => setVisible(false)}
          className="flex-shrink-0 text-navy-300 hover:text-navy-500 transition-colors p-1 rounded-lg hover:bg-navy-100/50"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="text-[10px] text-navy-400 mt-1.5 pl-1 font-medium tracking-wide uppercase">
        {isQuote ? 'Daily Motivation' : 'Fun Fact of the Day'}
      </div>
    </div>
  );
}

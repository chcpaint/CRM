import { User } from '../types';
import DailyDigest from '../components/dashboard/DailyDigest';

interface Props { user: User }

export default function ReportPage({ user }: Props) {
  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-navy-900">Daily Report</h1>
        <p className="text-navy-500 text-xs sm:text-sm mt-1">Your follow-ups, upcoming tasks, and team activity</p>
      </div>
      <DailyDigest user={user} alwaysShow />
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';

export default function StatisticsSection() {
  // Fetch real-time statistics from database
  const { data: stats, isLoading } = useQuery({
    queryKey: ['/api/homepage/statistics'],
    queryFn: async () => {
      const response = await fetch('/api/homepage/statistics');
      if (!response.ok) {
        throw new Error('Failed to fetch statistics');
      }
      return response.json();
    }
  });

  const colors = [
    "text-blue-400",
    "text-green-400", 
    "text-cyan-400",
    "text-purple-400"
  ];

  if (isLoading) {
    return (
      <section className="bg-slate-800 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="text-center space-y-2">
                <div className="text-4xl md:text-5xl font-bold text-slate-600 animate-pulse">
                  --
                </div>
                <div className="text-sm md:text-base text-slate-500 uppercase tracking-wide font-medium animate-pulse">
                  Loading...
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const statistics = stats || [
    { value: "0", label: "Cancer Types" },
    { value: "0%", label: "Detection Confidence" },
    { value: "0%", label: "Earlier Detection" },
    { value: "0%", label: "Workflow Efficiency" },
  ];

  return (
    <section className="bg-slate-800 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {statistics.map((stat: { value: string; label: string }, index: number) => (
            <div key={stat.label} className="text-center space-y-2">
              <div className={`text-4xl md:text-5xl font-bold ${colors[index]}`}>
                {stat.value}
              </div>
              <div className="text-sm md:text-base text-slate-300 uppercase tracking-wide font-medium">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

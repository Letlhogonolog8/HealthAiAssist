import React from 'react';

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
  onClick: () => void;
}

export function MetricCard({ title, value, subtitle, icon, color, onClick }: MetricCardProps) {
  return (
    <div 
      className={`bg-slate-800 border border-slate-600 rounded-lg cursor-pointer hover:border-${color}-500 hover:shadow-lg hover:shadow-${color}-500/20 transition-all duration-300 relative p-6`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <div className={`absolute top-2 right-2 text-xs text-${color}-400 opacity-70 flex items-center gap-1`}>
        <span>Click for details</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-medium text-${color}-400`}>{title}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
          <p className={`text-xs text-${color}-300`}>{subtitle}</p>
        </div>
        <div className={`w-8 h-8 text-${color}-400`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
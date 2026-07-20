import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../main';
import { todayISO } from '../store/selectors';
import { computeStats } from '../store/stats';

function level(count: number): number {
	if (count === 0) return 0;
	if (count === 1) return 1;
	if (count <= 3) return 2;
	if (count <= 6) return 3;
	return 4;
}

export function StatsView({ plugin }: { plugin: TaskFlowPlugin }) {
	const log = useStore(plugin.store, (s) => s.log);
	const stats = useMemo(() => computeStats(log, todayISO()), [log]);
	const scrollRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollLeft = el.scrollWidth;
	}, [stats.days.length]);

	if (stats.total === 0) {
		return <div className="taskflow-empty">Complete some tasks and your stats will grow here.</div>;
	}

	const tiles: [string, number][] = [
		['Today', stats.today],
		['This week', stats.week],
		['This month', stats.month],
		['All time', stats.total],
	];

	return (
		<div className="taskflow-stats">
			<div className="taskflow-stat-tiles">
				{tiles.map(([label, value]) => (
					<div key={label} className="taskflow-stat-tile">
						<div className="taskflow-stat-value">{value}</div>
						<div className="taskflow-stat-label">{label}</div>
					</div>
				))}
			</div>
			<div className="taskflow-streaks">
				{stats.currentStreak > 0
					? `🔥 ${stats.currentStreak}-day streak`
					: 'No current streak'}
				{stats.longestStreak > 1 && ` · longest ${stats.longestStreak}`}
			</div>
			<div className="taskflow-heatmap-scroll" ref={scrollRef}>
				<div className="taskflow-heatmap">
					{stats.days.map((d) => (
						<div
							key={d.date}
							className={`taskflow-heatcell taskflow-heatcell-level-${level(d.count)}`}
							title={`${d.count} task${d.count === 1 ? '' : 's'} · ${d.date}`}
						/>
					))}
				</div>
			</div>
			<div className="taskflow-heatmap-legend">
				<span>Less</span>
				{[0, 1, 2, 3, 4].map((l) => (
					<span key={l} className={`taskflow-heatcell taskflow-heatcell-level-${l}`} />
				))}
				<span>More</span>
			</div>
		</div>
	);
}

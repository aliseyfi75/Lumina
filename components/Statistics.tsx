import React, { useMemo } from 'react';
import { Flashcard, FlashcardStatus } from '../types';
import { CartesianGrid, Line, LineChart, BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Activity, Flame, BookOpen, Brain, CheckCircle, TrendingUp, Calendar, Target, Clock } from 'lucide-react';
import { format, subDays, startOfDay, eachDayOfInterval, differenceInDays } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface StatisticsProps {
    cards: Flashcard[];
    studyHistory: Record<string, number>;
    longestStreak: number;
}
export const Statistics: React.FC<StatisticsProps> = ({ cards, studyHistory, longestStreak }) => {
    const [activeChartTab, setActiveChartTab] = React.useState<'growth' | 'building' | 'remaining' | 'future'>('growth');
    const [timeframe, setTimeframe] = React.useState<'weekly' | 'monthly' | 'yearly'>('weekly');
    // Stats calculations
    const totalCards = cards.length;
    const newCount = cards.filter(c => c.status === FlashcardStatus.New).length;
    const learningCount = cards.filter(c => c.status === FlashcardStatus.Learning).length;
    const masteredCount = cards.filter(c => c.status === FlashcardStatus.Mastered).length;

    // Streak Calculation
    const currentStreak = useMemo(() => {
        let streak = 0;
        let currentDate = new Date();
        const todayStr = format(currentDate, 'yyyy-MM-dd');

        // Check if we studied today or yesterday to continue streak
        if (!studyHistory[todayStr] || studyHistory[todayStr] === 0) {
            currentDate = subDays(currentDate, 1);
            const yesterdayStr = format(currentDate, 'yyyy-MM-dd');
            if (!studyHistory[yesterdayStr] || studyHistory[yesterdayStr] === 0) {
                return 0; // No activity today or yesterday, streak is 0
            }
        }

        while (studyHistory[format(currentDate, 'yyyy-MM-dd')] > 0) {
            streak++;
            currentDate = subDays(currentDate, 1);
        }
        return streak;
    }, [studyHistory]);

    // Heatmap Data (Last 91 days - makes 13 weeks of 7 days)
    const heatmapDays = useMemo(() => {
        const today = startOfDay(new Date());
        const startDate = subDays(today, 90);
        const interval = eachDayOfInterval({ start: startDate, end: today });

        return interval.map(date => {
            const dateStr = format(date, 'yyyy-MM-dd');
            const count = studyHistory[dateStr] || 0;
            let level = 0;
            if (count > 0 && count <= 10) level = 1;
            else if (count > 10 && count <= 30) level = 2;
            else if (count > 30 && count <= 60) level = 3;
            else if (count > 60) level = 4;

            return {
                date,
                dateStr,
                count,
                level,
            };
        });
    }, [studyHistory]);

    // Chart Data Generation
    const chartData = useMemo(() => {
        if (cards.length === 0) return { historical: [], future: [] };

        // Group cards by creation date
        const sortedCards = [...cards].sort((a, b) => a.createdAt - b.createdAt);
        const firstDate = startOfDay(new Date(sortedCards[0].createdAt));
        const today = startOfDay(new Date());

        let daysToSubtract;
        switch (timeframe) {
            case 'weekly': daysToSubtract = 7; break;
            case 'monthly': daysToSubtract = 30; break;
            case 'yearly': daysToSubtract = 365; break;
            default: daysToSubtract = 365;
        }

        const calculatedStartDate = subDays(today, daysToSubtract);
        // Start date should be the requested timeframe or the first card date, whichever is more recent.
        const startDate = differenceInDays(today, firstDate) > daysToSubtract ? calculatedStartDate : firstDate;

        const historyInterval = eachDayOfInterval({ start: startDate, end: subDays(today, -1) });

        let cumulativeTotal = 0;
        let cardIndex = 0;

        // Pre-compute total up to start date
        while (cardIndex < sortedCards.length && startOfDay(new Date(sortedCards[cardIndex].createdAt)) < startDate) {
            cumulativeTotal++;
            cardIndex++;
        }

        const historical = historyInterval.map(date => {
            const isTomorrow = date > today;

            if (isTomorrow) {
                return {
                    date: format(date, 'MMM dd, yyyy')
                };
            }

            // Update total created up to this date
            while (cardIndex < sortedCards.length && startOfDay(new Date(sortedCards[cardIndex].createdAt)) <= date) {
                cumulativeTotal++;
                cardIndex++;
            }

            // Approximate Mastering Date using lastReviewed if status is currently Mastered
            const masteredCount = cards.filter(c =>
                c.status === FlashcardStatus.Mastered &&
                startOfDay(new Date(c.lastReviewed || c.createdAt)) <= date
            ).length;

            const remainingCount = cumulativeTotal - masteredCount;

            return {
                date: format(date, 'MMM dd, yyyy'),
                total: cumulativeTotal,
                mastered: masteredCount,
                remaining: remainingCount
            };
        });

        // Future Reviews Histogram Data (Next 30 Days)
        const futureStartDate = today;
        const futureEndDate = differenceInDays(today, firstDate) > 30 ? subDays(today, -30) : subDays(today, -30) // 30 days into future
        const futureInterval = eachDayOfInterval({ start: futureStartDate, end: futureEndDate });

        const learningCards = cards.filter(c => c.status === FlashcardStatus.Learning);

        const future = futureInterval.map((date, index) => {
            let dueCount = 0;
            if (index === 0) {
                // First bucket (Today) includes anything due today or overdue
                dueCount = learningCards.filter(c => c.nextReviewDate && startOfDay(new Date(c.nextReviewDate)) <= date).length;
            } else {
                // Other buckets match exact day
                dueCount = learningCards.filter(c => c.nextReviewDate && startOfDay(new Date(c.nextReviewDate)).getTime() === date.getTime()).length;
            }

            return {
                date: format(date, 'MMM dd, yyyy'),
                reviews: dueCount
            };
        });

        return { historical, future };
    }, [cards, timeframe]);


    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            <div className="flex flex-col md:flex-row gap-6 justify-between items-end">
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-white">Statistics</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Track your learning progress and vocabulary growth</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3 bg-white dark:bg-slate-800 px-5 py-3 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl">
                            <Target className="h-6 w-6 text-slate-500 dark:text-slate-400" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Longest Streak</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{longestStreak} <span className="text-base font-medium text-slate-500 dark:text-slate-400">{longestStreak === 1 ? 'Day' : 'Days'}</span></p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 bg-white dark:bg-slate-800 px-5 py-3 rounded-2xl shadow-sm border border-orange-200 dark:border-orange-800/50 ring-1 ring-orange-100 dark:ring-orange-900/50 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-orange-400/20 to-transparent blur-xl"></div>
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/40 rounded-xl relative overflow-hidden group">
                            <div className="absolute inset-0 bg-orange-300 opacity-0 group-hover:opacity-30 transition-opacity blur-md"></div>
                            <Flame className="h-6 w-6 text-orange-500 relative z-10" />
                        </div>
                        <div className="relative z-10">
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Current Streak</p>
                            <p className="text-2xl font-bold text-orange-600">{currentStreak} <span className="text-base font-medium text-orange-400">{currentStreak === 1 ? 'Day' : 'Days'}</span></p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-slate-100 dark:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-300"><BookOpen className="h-6 w-6" /></div>
                    <div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{totalCards}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Total Cards</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-xl text-blue-600 dark:text-blue-400"><Activity className="h-6 w-6" /></div>
                    <div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{newCount}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">New</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-amber-100 dark:bg-amber-900/40 rounded-xl text-amber-600 dark:text-amber-400"><Brain className="h-6 w-6" /></div>
                    <div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{learningCount}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Learning</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-green-100 dark:bg-green-900/40 rounded-xl text-green-600 dark:text-green-400"><CheckCircle className="h-6 w-6" /></div>
                    <div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{masteredCount}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Mastered</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col hover:border-brand-200 transition-colors">
                    <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-brand-500" />
                            Progress Charts
                        </h2>

                        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 p-1 rounded-xl">
                            <button
                                onClick={() => setActiveChartTab('growth')}
                                className={cn("px-3 py-1.5 text-xs font-medium rounded-lg transition-colors", activeChartTab === 'growth' ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200")}
                            >
                                Mastered
                            </button>
                            <button
                                onClick={() => setActiveChartTab('building')}
                                className={cn("px-3 py-1.5 text-xs font-medium rounded-lg transition-colors", activeChartTab === 'building' ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200")}
                            >
                                Total Built
                            </button>
                            <button
                                onClick={() => setActiveChartTab('remaining')}
                                className={cn("px-3 py-1.5 text-xs font-medium rounded-lg transition-colors", activeChartTab === 'remaining' ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200")}
                            >
                                Remaining
                            </button>
                            <button
                                onClick={() => setActiveChartTab('future')}
                                className={cn("px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1", activeChartTab === 'future' ? "bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 shadow-sm border border-brand-100 dark:border-brand-800" : "text-slate-500 dark:text-slate-400 hover:text-brand-600 hover:bg-brand-50/50")}
                            >
                                <Clock className="h-3 w-3" />
                                Reminders
                            </button>
                        </div>
                    </div>

                    {activeChartTab !== 'future' && (
                        <div className="flex justify-end mb-4">
                            <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-700 p-1 rounded-lg border border-slate-200 dark:border-slate-600">
                                <button
                                    onClick={() => setTimeframe('weekly')}
                                    className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors", timeframe === 'weekly' ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-500" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200")}
                                >
                                    1W
                                </button>
                                <button
                                    onClick={() => setTimeframe('monthly')}
                                    className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors", timeframe === 'monthly' ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-500" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200")}
                                >
                                    1M
                                </button>
                                <button
                                    onClick={() => setTimeframe('yearly')}
                                    className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors", timeframe === 'yearly' ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-500" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200")}
                                >
                                    1Y
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="flex-1 w-full min-h-[300px]">
                        {chartData.historical.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                {activeChartTab === 'future' ? (
                                    <BarChart data={chartData.future} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis
                                            dataKey="date"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#64748b', fontSize: 12 }}
                                            dy={10}
                                            minTickGap={20}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#64748b', fontSize: 12 }}
                                        />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                            cursor={{ fill: '#f1f5f9' }}
                                            labelStyle={{ color: '#0f172a', fontWeight: 'bold', marginBottom: '4px' }}
                                        />
                                        <Bar dataKey="reviews" name="# words" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                ) : (
                                    <LineChart data={chartData.historical} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis
                                            dataKey="date"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#64748b', fontSize: 12 }}
                                            dy={10}
                                            minTickGap={30}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#64748b', fontSize: 12 }}
                                        />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                            cursor={{ stroke: '#cbd5e1', strokeWidth: 2, strokeDasharray: '4 4' }}
                                            labelStyle={{ color: '#0f172a', fontWeight: 'bold', marginBottom: '4px' }}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" />

                                        {activeChartTab === 'growth' && (
                                            <Line
                                                name="Mastered Words"
                                                type="monotone"
                                                dataKey="mastered"
                                                stroke="#10b981"
                                                strokeWidth={3}
                                                dot={false}
                                                activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                                                animationDuration={1500}
                                            />
                                        )}
                                        {activeChartTab === 'building' && (
                                            <Line
                                                name="Total Vocabulary"
                                                type="monotone"
                                                dataKey="total"
                                                stroke="#3b82f6"
                                                strokeWidth={3}
                                                dot={false}
                                                activeDot={{ r: 6, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                                                animationDuration={1500}
                                            />
                                        )}
                                        {activeChartTab === 'remaining' && (
                                            <Line
                                                name="Remaining to Master"
                                                type="monotone"
                                                dataKey="remaining"
                                                stroke="#f43f5e"
                                                strokeWidth={3}
                                                dot={false}
                                                activeDot={{ r: 6, fill: '#f43f5e', stroke: '#fff', strokeWidth: 2 }}
                                                animationDuration={1500}
                                            />
                                        )}
                                    </LineChart>
                                )}
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full w-full flex items-center justify-center text-slate-400 dark:text-slate-500 font-medium">
                                Start adding cards to see your growth
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col hover:border-brand-200 transition-colors">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Calendar className="h-5 w-5 text-brand-500" />
                            Activity (Last 90 Days)
                        </h2>
                    </div>

                    <div className="flex-1 flex flex-col justify-center gap-6">
                        <div className="bg-slate-50/50 dark:bg-slate-900/50 p-4 justify-center items-center flex rounded-xl border border-slate-100 dark:border-slate-700 overflow-x-auto">
                            <div
                                className="grid gap-[3px]"
                                style={{
                                    gridAutoFlow: 'column',
                                    gridTemplateRows: 'repeat(7, minmax(0, 1fr))',
                                    gridTemplateColumns: 'repeat(13, minmax(0, 1fr))',
                                    aspectRatio: '13 / 7',
                                    width: '100%',
                                    maxWidth: '320px'
                                }}
                            >
                                {heatmapDays.map((day) => (
                                    <div
                                        key={day.dateStr}
                                        title={`${day.dateStr}: ${day.count} interaction${day.count === 1 ? '' : 's'}`}
                                        className={cn(
                                            "w-full h-full rounded-[3px] transition-colors duration-200 hover:ring-2 ring-slate-400 ring-offset-1 cursor-crosshair",
                                            day.level === 0 && "bg-slate-200",
                                            day.level === 1 && "bg-brand-200",
                                            day.level === 2 && "bg-brand-300",
                                            day.level === 3 && "bg-brand-500",
                                            day.level === 4 && "bg-brand-700"
                                        )}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium px-2">
                            <span>Less</span>
                            <div className="flex gap-1.5">
                                <div className="w-3.5 h-3.5 rounded-[3px] bg-slate-200 dark:bg-slate-700" />
                                <div className="w-3.5 h-3.5 rounded-[3px] bg-brand-200" />
                                <div className="w-3.5 h-3.5 rounded-[3px] bg-brand-300" />
                                <div className="w-3.5 h-3.5 rounded-[3px] bg-brand-500" />
                                <div className="w-3.5 h-3.5 rounded-[3px] bg-brand-700" />
                            </div>
                            <span>More</span>
                        </div>

                        <div className="mt-auto bg-brand-50 dark:bg-brand-900/20 rounded-xl p-4 border border-brand-100 dark:border-brand-800/40">
                            <p className="text-sm text-brand-800 dark:text-brand-300 font-medium text-center">
                                Consistency is key. Studying a few cards every day helps build long-term retention.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

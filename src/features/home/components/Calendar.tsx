import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

const DAY_SIZE = 43;
const CALENDAR_BODY_HEIGHT = DAY_SIZE * 4.5 + 32;
const CALENDAR_BG = '#7B845D';
const CALENDAR_BORDER = '#5F6646';
const DAY_BG = '#C8B79A';
const DAY_TEXT = '#2C2F1D';
const TODAY_BG = '#D8D98B';

function getMonthGrid(year: number, month: number): Array<number | null> {
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + totalDays) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - firstDay + 1;
    return dayNumber > 0 && dayNumber <= totalDays ? dayNumber : null;
  });
}

export function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const today = new Date();
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthLabel = `${MONTHS[month]} ${year}`;

  const days = useMemo(() => getMonthGrid(year, month), [year, month]);

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  return (
    <View
      className="w-full rounded-3xl px-3 py-3"
      style={{ backgroundColor: CALENDAR_BG, borderWidth: 1, borderColor: CALENDAR_BORDER }}>
      <View className="mb-3 flex-row items-center justify-between px-1">
        <Pressable onPress={handlePrevMonth} hitSlop={10} accessibilityLabel="Mes anterior">
          <Text className="text-lg" style={{ color: DAY_TEXT }}>
            {'<'}
          </Text>
        </Pressable>
        <Text className="font-inter-bold text-lg" style={{ color: DAY_TEXT }}>
          {monthLabel}
        </Text>
        <Pressable onPress={handleNextMonth} hitSlop={10} accessibilityLabel="Mes siguiente">
          <Text className="text-lg" style={{ color: DAY_TEXT }}>
            {'>'}
          </Text>
        </Pressable>
      </View>

      <View className="mb-2 flex-row justify-between px-1">
        {WEEKDAYS.map((label, index) => (
          <Text
            key={`${label}-${index}`}
            style={{ width: DAY_SIZE, textAlign: 'center', color: DAY_TEXT }}
            className="font-inter-semibold text-base">
            {label}
          </Text>
        ))}
      </View>

      <ScrollView
        style={{ height: CALENDAR_BODY_HEIGHT }}
        contentContainerStyle={{ paddingBottom: 4 }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled>
        <View className="flex-row flex-wrap bg-slate-400">
          {days.map((day, index) => {
            const isToday =
              day !== null &&
              today.getFullYear() === year &&
              today.getMonth() === month &&
              today.getDate() === day;

            return (
              <View
                key={`day-${index}`}
                style={{ width: '14.2857%', alignItems: 'center', marginBottom: 8 }}>
                {day === null ? (
                  <View style={{ width: DAY_SIZE, height: DAY_SIZE }} />
                ) : (
                  <View
                    style={{
                      width: DAY_SIZE,
                      height: DAY_SIZE,
                      borderRadius: DAY_SIZE / 2,
                      backgroundColor: isToday ? TODAY_BG : DAY_BG,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Text style={{ color: DAY_TEXT }} className="font-inter-semibold text-base">
                      {day}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

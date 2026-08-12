import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface SwipeableMonthProps {
  monthKey: string;
  direction: number;
  onSwipe: (delta: number) => void;
  children: React.ReactNode;
}

/** Slides between months and lets a phone user swipe left/right to change month. */
export function SwipeableMonth({ monthKey, direction, onSwipe, children }: SwipeableMonthProps) {
  return (
    <div className="relative overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={monthKey}
          initial={{ x: direction > 0 ? '100%' : '-100%', opacity: 0.4 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: direction > 0 ? '-100%' : '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.12}
          onDragEnd={(_, info) => {
            if (info.offset.x > 60) onSwipe(-1);
            else if (info.offset.x < -60) onSwipe(1);
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

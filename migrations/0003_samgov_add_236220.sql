-- Add NAICS 236220 (commercial building construction): much federal sitework is filed under it.
UPDATE boards
   SET search_parameter_mapping = '{"naics":["238910","237310","237110","237990","236220"],"lookback_days":3}'
 WHERE board_id = 'samgov';

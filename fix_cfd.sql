DELETE FROM custom_field_definitions WHERE key = 'cf_';
UPDATE custom_field_definitions SET key = 'bin_location' WHERE key = 'cf_bin_location';

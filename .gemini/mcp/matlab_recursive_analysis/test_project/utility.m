% 工具脚本 - 包含多层调用关系
function utils = utility_manager()
    utils.log_info = @log_info;
    utils.calculate_average = @calculate_average;
    utils.validate_input = @validate_input;
    utils.process_data = @process_data;
end

function log_info(message)
    fprintf('[UTILITY] %s\n', message);
    timestamp = datestr(now);
    fprintf('[TIMESTAMP] %s\n', timestamp);
end

function avg = calculate_average(numbers)
    avg = mean(numbers);
    validate_numbers(numbers);
end

function validate_input(input_data)
    if ~isnumeric(input_data)
        error('Invalid input type');
    end
    if isempty(input_data)
        error('Empty input data');
    end
    log_validation('Input validated successfully');
end

function validate_numbers(numbers)
    if any(isnan(numbers))
        error('NaN values found');
    end
    if any(isinf(numbers))
        error('Infinite values found');
    end
end

function data = process_data(input_data)
    data = input_data * 2;
    validate_processed_data(data);
end

function validate_processed_data(data)
    if any(data < 0)
        warning('Negative values in processed data');
    end
end

function log_validation(message)
    fprintf('[VALIDATION] %s\n', message);
end 
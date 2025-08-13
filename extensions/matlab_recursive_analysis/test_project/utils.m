% 工具函数脚本
function utils = create_utils()
    utils.print_info = @print_info;
    utils.calculate_average = @calculate_average;
    utils.validate_input = @validate_input;
end

function print_info(message)
    fprintf('[INFO] %s\n', message);
end

function avg = calculate_average(numbers)
    avg = mean(numbers);
end

function valid = validate_input(input_data)
    valid = isnumeric(input_data) && ~isempty(input_data);
end 